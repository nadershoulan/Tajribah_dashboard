/**
 * A4 — what staff can do to a store (ADM-08): extend its trial, suspend or restore it, adjust
 * its AI credits. Every action needs a written reason and lands in **two** trails: the staff
 * trail, and the store's own activity trail as a `staff` action (the merchant can see that
 * Tajribah changed something, and when).
 *
 * Trial and suspension changes are one admin-handle transaction: the store row locked, the
 * change, the store's audit row, the staff trail row — all or nothing. A credit adjustment goes
 * through the ledger's own `adjustCredits` (its rules: never below zero, audited in the store,
 * append-only), acting as the staff member; the staff trail row follows it.
 */
import { eq } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { auditLogs, subscriptions, tenants, type Tenant } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { errors } from '@/server/core/errors/problem';
import { adjustCredits } from '@/server/modules/billing/credits';
import { staffLog, type StaffContext } from './access';
import { staffActingContext } from './stores';

const DAY = 86_400_000;

export type StoreAction =
  | { type: 'extend_trial'; days: number; reason: string }
  | { type: 'suspend'; reason: string }
  | { type: 'restore'; reason: string }
  | { type: 'adjust_credits'; delta: number; reason: string };

/** The status a suspended store returns to: what its subscription says, or its trial. */
function restoredStatus(subscription: string | null): Tenant['status'] {
  switch (subscription) {
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'cancelled': case 'expired': case 'paused': return 'cancelled';
    default: return 'trial';
  }
}

export async function actOnStore(staff: StaffContext, storeId: string, action: StoreAction, now = new Date()): Promise<void> {
  const reason = action.reason.trim();
  if (reason.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  if (action.type === 'adjust_credits') return adjust(staff, storeId, action.delta, reason, now);

  await unsafeAdminDb().transaction(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, storeId)).for('update');
    if (!tenant || tenant.deletedAt) throw errors.notFound('store');
    const [sub] = await tx.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.tenantId, storeId)).limit(1);

    let patch: Partial<typeof tenants.$inferInsert>;
    let name: string;
    let detail: Record<string, unknown>;
    switch (action.type) {
      case 'extend_trial': {
        if (!Number.isInteger(action.days) || action.days < 1 || action.days > 90) throw errors.validation({ days: ['1 to 90 days'] });
        if (tenant.status !== 'trial' || (sub && (sub.status === 'active' || sub.status === 'past_due'))) throw errors.conflict('only a store on its trial can have the trial extended');
        const from = Math.max(now.getTime(), tenant.trialEndsAt?.getTime() ?? now.getTime());
        patch = { trialEndsAt: new Date(from + action.days * DAY) };
        name = 'store.trial_extend';
        detail = { days: action.days, from: tenant.trialEndsAt?.toISOString() ?? null, to: patch.trialEndsAt!.toISOString() };
        break;
      }
      case 'suspend':
        if (tenant.status === 'suspended') throw errors.conflict('the store is already suspended');
        patch = { status: 'suspended' };
        name = 'store.suspend';
        detail = { from: tenant.status };
        break;
      case 'restore':
        if (tenant.status !== 'suspended') throw errors.conflict('the store is not suspended');
        patch = { status: restoredStatus(sub?.status ?? null) };
        name = 'store.restore';
        detail = { to: patch.status };
        break;
    }

    await tx.update(tenants).set(patch).where(eq(tenants.id, storeId));
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (tenant as Record<string, unknown>)[k] ?? null]));
    await tx.insert(auditLogs).values({
      id: uuidv7(), tenantId: storeId, actorUserId: staff.userId, actorType: 'staff', action: 'update',
      resourceType: 'store', resourceId: storeId, changes: { before, after: patch as Record<string, unknown> }, requestId: staff.requestId,
    });
    await staffLog(staff, { action: name, targetType: 'store', targetId: storeId, storeId, reason, detail }, tx as unknown as Db);
  });
}

/** A credit adjustment as the staff member: the ledger's rules, the store's trail, then the staff trail. */
async function adjust(staff: StaffContext, storeId: string, delta: number, reason: string, now: Date): Promise<void> {
  const [tenant] = await unsafeAdminDb().select().from(tenants).where(eq(tenants.id, storeId)).limit(1);
  if (!tenant || tenant.deletedAt) throw errors.notFound('store');
  const ctx = staffActingContext(tenant, staff, ['billing:read', 'billing:write']);
  const entry = await adjustCredits(ctx, delta, `${reason} (staff: ${staff.email})`, now);
  await staffLog(staff, { action: 'store.credits_adjust', targetType: 'store', targetId: storeId, storeId, reason, detail: { delta, balanceAfter: entry.balanceAfter } });
}
