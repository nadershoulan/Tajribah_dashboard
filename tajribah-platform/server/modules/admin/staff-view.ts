/**
 * A4b — "view as the store" (ADM-08): a staff member's own session pointed at one store,
 * read-only, for 5 to 60 minutes.
 *
 *  - Starting needs the staff console (staff + two-step sign-in) and a written reason. The
 *    store's activity trail records that staff viewed it, and until when; the staff trail too.
 *  - While it lasts, every request builds `buildStaffViewContext`: reads only, re-checked each
 *    time (the end time, and staff status).
 *  - It ends when staff press Stop, when the time passes (noticed on the next `/me`), or when
 *    the session switches store. The session returns to the store it was on before.
 */
import { eq } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { auditLogs, sessions, tenants } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { errors } from '@/server/core/errors/problem';
import { staffLog, type StaffContext } from './access';

export const STAFF_VIEW_MINUTES = { min: 5, max: 60 } as const;

type Tx = Parameters<Parameters<ReturnType<typeof unsafeAdminDb>['transaction']>[0]>[0];

async function storeTrail(tx: Tx, tenantId: string, staffUserId: string, requestId: string, action: 'create' | 'delete', after: Record<string, unknown>) {
  await tx.insert(auditLogs).values({
    id: uuidv7(), tenantId, actorUserId: staffUserId, actorType: 'staff', action,
    resourceType: 'staff_view', resourceId: null, changes: { after }, requestId,
  });
}

/** Point this staff session at the store, read-only, until `minutes` from now. */
export async function startStaffView(staff: StaffContext, sessionId: string, storeId: string, input: { minutes: number; reason: string }, now = new Date()): Promise<{ until: string }> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  if (!Number.isInteger(input.minutes) || input.minutes < STAFF_VIEW_MINUTES.min || input.minutes > STAFF_VIEW_MINUTES.max) {
    throw errors.validation({ minutes: [`${STAFF_VIEW_MINUTES.min} to ${STAFF_VIEW_MINUTES.max} minutes`] });
  }
  const until = new Date(now.getTime() + input.minutes * 60_000);
  await unsafeAdminDb().transaction(async (tx) => {
    const [store] = await tx.select().from(tenants).where(eq(tenants.id, storeId)).limit(1);
    if (!store || store.deletedAt) throw errors.notFound('store');
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for('update');
    if (!session || session.revokedAt || session.userId !== staff.userId) throw errors.unauthenticated();
    // Moving from one store's view to another keeps the original store to return to.
    const returnTo = session.impersonatingUntil ? session.impersonationReturnTenantId : session.tenantId;
    if (session.impersonatingUntil && session.tenantId && session.tenantId !== storeId) {
      await storeTrail(tx, session.tenantId, staff.userId, staff.requestId, 'delete', { endedBy: 'another view' });
    }
    await tx.update(sessions).set({ tenantId: storeId, impersonatingUntil: until, impersonationReturnTenantId: returnTo, lastSeenAt: now }).where(eq(sessions.id, sessionId));
    await storeTrail(tx, storeId, staff.userId, staff.requestId, 'create', { until: until.toISOString(), minutes: input.minutes });
    await staffLog(staff, { action: 'store.view_start', targetType: 'store', targetId: storeId, storeId, reason, detail: { minutes: input.minutes, until: until.toISOString() } }, tx as unknown as Db);
  });
  return { until: until.toISOString() };
}

/**
 * End the staff view on this session and go back to the store it came from. `why`: the staff
 * member pressed Stop, or the time had passed (or they are no longer staff) when noticed.
 * Returns false when there was no view to end.
 */
export async function endStaffView(sessionId: string, input: { userId: string; requestId: string; why: 'stopped' | 'expired' | 'no longer staff' }): Promise<boolean> {
  return unsafeAdminDb().transaction(async (tx) => {
    const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for('update');
    if (!session || session.userId !== input.userId || !session.impersonatingUntil) return false;
    await tx.update(sessions).set({ tenantId: session.impersonationReturnTenantId, impersonatingUntil: null, impersonationReturnTenantId: null }).where(eq(sessions.id, sessionId));
    if (session.tenantId) {
      await storeTrail(tx, session.tenantId, input.userId, input.requestId, 'delete', { endedBy: input.why });
      await staffLog({ userId: input.userId, email: '', fullName: '', requestId: input.requestId },
        { action: 'store.view_end', targetType: 'store', targetId: session.tenantId, storeId: session.tenantId, reason: null, detail: { why: input.why } }, tx as unknown as Db);
    }
    return true;
  });
}
