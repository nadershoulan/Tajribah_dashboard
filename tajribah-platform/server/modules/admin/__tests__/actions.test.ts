/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A4 — staff change a store: a written reason every time, the store's own trail and the staff
 * trail both record it, and the rules hold (only a trial is extended, a restore returns the
 * status the subscription implies, credits never go below zero).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, creditLedger, staffAudit, subscriptions, tenants } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, seededPlanId } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { actOnStore } from '@/server/modules/admin/actions';

setLogLevel('error');
const DAY = 86_400_000;
const STAFF = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });

test('extend a trial: from its end (or now, if it has passed), both trails, only while on trial', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const staff = STAFF(store.userId);
    const now = new Date('2026-09-26T00:00:00Z');
    const set = (patch: any) => harness.asAdmin(() => harness.db.update(tenants).set(patch).where(eq(tenants.id, store.tenantId)));
    const tenant = async () => (await harness.asAdmin(() => harness.db.select().from(tenants).where(eq(tenants.id, store.tenantId))))[0]!;

    await set({ status: 'trial', trialEndsAt: new Date(now.getTime() + 3 * DAY) });
    await actOnStore(staff, store.tenantId, { type: 'extend_trial', days: 7, reason: 'launch delayed by the platform' }, now);
    assert.equal((await tenant()).trialEndsAt!.getTime(), now.getTime() + 10 * DAY, 'added to the end, not to today');

    await set({ trialEndsAt: new Date(now.getTime() - 5 * DAY) });
    await actOnStore(staff, store.tenantId, { type: 'extend_trial', days: 7, reason: 'came back after the trial' }, now);
    assert.equal((await tenant()).trialEndsAt!.getTime(), now.getTime() + 7 * DAY, 'a passed trial restarts from today');

    const audit = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.tenantId, store.tenantId)));
    const mine = audit.filter((r) => r.resourceType === 'store');
    assert.equal(mine.length, 2, 'the store’s own trail');
    assert.ok(mine.every((r) => r.actorType === 'staff' && r.actorUserId === store.userId));
    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.deepEqual(trail.map((r) => [r.action, r.storeId, r.reason]), [
      ['store.trial_extend', store.tenantId, 'launch delayed by the platform'],
      ['store.trial_extend', store.tenantId, 'came back after the trial'],
    ]);

    await assert.rejects(() => actOnStore(staff, store.tenantId, { type: 'extend_trial', days: 7, reason: ' ok ' }, now), (e: any) => e.code === 'validation_failed', 'a reason is required');
    await assert.rejects(() => actOnStore(staff, store.tenantId, { type: 'extend_trial', days: 0, reason: 'zero days' }, now), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => actOnStore(staff, store.tenantId, { type: 'extend_trial', days: 91, reason: 'too many days' }, now), (e: any) => e.code === 'validation_failed');

    const growth = await seededPlanId(harness, 'growth');
    await harness.asAdmin(() => harness.db.insert(subscriptions).values({ tenantId: store.tenantId, planId: growth, status: 'active', currentPeriodStart: now, currentPeriodEnd: now } as any));
    await assert.rejects(() => actOnStore(staff, store.tenantId, { type: 'extend_trial', days: 7, reason: 'a paying store' }, now), (e: any) => e.code === 'conflict', 'a paying store has no trial to extend');
    await set({ status: 'active' });
    await assert.rejects(() => actOnStore(staff, store.tenantId, { type: 'extend_trial', days: 7, reason: 'an active store' }, now), (e: any) => e.code === 'conflict');
    assert.equal((await harness.asAdmin(() => harness.db.select().from(staffAudit))).length, 2, 'a refusal leaves no trail row');
    await assert.rejects(() => actOnStore(staff, uuidv7(), { type: 'suspend', reason: 'no such store' }, now), (e: any) => e.code === 'not_found');
  } finally { await harness.close(); }
});

test('suspend and restore: back to what the subscription says, or the trial; both trails; no double suspend', async () => {
  const harness = await createTestDb();
  try {
    const trial = await seedTenant(harness, 'alpha');
    const paying = await seedTenant(harness, 'bravo');
    const staff = STAFF(trial.userId);
    const status = async (id: string) => (await harness.asAdmin(() => harness.db.select().from(tenants).where(eq(tenants.id, id))))[0]!.status;
    const growth = await seededPlanId(harness, 'growth');
    await harness.asAdmin(async () => {
      await harness.db.update(tenants).set({ status: 'past_due' }).where(eq(tenants.id, paying.tenantId));
      await harness.db.insert(subscriptions).values({ tenantId: paying.tenantId, planId: growth, status: 'past_due', currentPeriodStart: new Date(), currentPeriodEnd: new Date() } as any);
    });

    await actOnStore(staff, trial.tenantId, { type: 'suspend', reason: 'abuse report #12' });
    assert.equal(await status(trial.tenantId), 'suspended');
    await assert.rejects(() => actOnStore(staff, trial.tenantId, { type: 'suspend', reason: 'again please' }), (e: any) => e.code === 'conflict');
    await actOnStore(staff, trial.tenantId, { type: 'restore', reason: 'report was wrong' });
    assert.equal(await status(trial.tenantId), 'trial', 'no subscription: back to the trial');
    await assert.rejects(() => actOnStore(staff, trial.tenantId, { type: 'restore', reason: 'not suspended' }), (e: any) => e.code === 'conflict');

    await actOnStore(staff, paying.tenantId, { type: 'suspend', reason: 'chargeback fraud' });
    await actOnStore(staff, paying.tenantId, { type: 'restore', reason: 'cleared by the bank' });
    assert.equal(await status(paying.tenantId), 'past_due', 'what the subscription says');

    const audit = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.tenantId, paying.tenantId)));
    assert.deepEqual(audit.filter((r) => r.resourceType === 'store').map((r) => [r.actorType, (r.changes as any).after.status]), [['staff', 'suspended'], ['staff', 'past_due']]);
    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit).where(eq(staffAudit.storeId, paying.tenantId)));
    assert.deepEqual(trail.map((r) => [r.action, r.reason]), [['store.suspend', 'chargeback fraud'], ['store.restore', 'cleared by the bank']]);
  } finally { await harness.close(); }
});

test('adjust credits: through the ledger, never below zero, both trails', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const staff = STAFF(store.userId);
    await actOnStore(staff, store.tenantId, { type: 'adjust_credits', delta: 25, reason: 'failed generations refunded' });
    await assert.rejects(() => actOnStore(staff, store.tenantId, { type: 'adjust_credits', delta: -1000, reason: 'too many taken' }), (e: any) => e.code === 'conflict');

    const ledger = await harness.asAdmin(() => harness.db.select().from(creditLedger).where(eq(creditLedger.tenantId, store.tenantId)));
    const adjustment = ledger.filter((r) => r.reason === 'adjustment');
    assert.deepEqual(adjustment.map((r) => r.delta), [25]);
    assert.match(adjustment[0]!.note ?? '', /failed generations refunded \(staff: staff@tajribah\.test\)/);
    const audit = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.tenantId, store.tenantId)));
    assert.deepEqual(audit.filter((r) => r.resourceType === 'credit_adjustment').map((r) => [r.actorType, r.actorUserId]), [['staff', store.userId]]);
    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.deepEqual(trail.map((r) => [r.action, r.reason, (r.detail as any).delta]), [['store.credits_adjust', 'failed generations refunded', 25]]);
  } finally { await harness.close(); }
});
