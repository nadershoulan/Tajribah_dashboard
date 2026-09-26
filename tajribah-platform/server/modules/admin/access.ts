/**
 * A1 — who may use the admin console, and the record of what they did there.
 *
 * Rules that are not style choices:
 *  - **Staff only.** `users.is_staff` is set in the database by the operator — never by a
 *    screen or an endpoint. To anyone else every admin endpoint is a 404: the console is not
 *    even confirmed to exist.
 *  - **Two-step sign-in is required** (ADM-01). A staff account without it is refused (403)
 *    with the way to turn it on; a stolen staff password alone opens nothing.
 *  - **Every staff action is written to `staff_audit`**, platform-wide, admin role only — and,
 *    when it concerns a store, to that store's own trail too (A4), so a merchant can see it.
 *
 * Staff read across stores by definition, so this module (and the admin screens' services)
 * use the admin handle; each query filters explicitly.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { staffAudit, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { apiConfig, authenticate, type ApiConfig } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';
import { currentScope } from '@/server/core/observability/scope';

/** `sessionId`: the staff member's session, when the request has one (A4b points it at a store). */
export type StaffContext = { userId: string; email: string; fullName: string; requestId: string; sessionId?: string };

/** The staff member behind this request, or a 404 (not staff) / 403 (no two-step sign-in). */
export async function staffContextFor(request: Request, config: ApiConfig = apiConfig()): Promise<StaffContext> {
  const caller = await authenticate(request, config);
  const [user] = await unsafeAdminDb().select().from(users).where(eq(users.id, caller.userId)).limit(1);
  if (!user || user.deletedAt || !user.isStaff) throw errors.notFound('page');
  if (!user.totpEnabled) throw errors.forbidden('staff accounts must use two-step sign-in — turn it on in Sign-in security');
  return { userId: user.id, email: user.email, fullName: user.fullName, requestId: currentScope()?.requestId ?? 'unscoped', sessionId: caller.sessionId };
}

export type StaffAction = {
  action: string;
  targetType: string;
  targetId?: string | null;
  storeId?: string | null;
  reason?: string | null;
  detail?: Record<string, unknown> | null;
};

/** Write one staff action. Called in the same transaction as the change when there is one. */
export async function staffLog(staff: StaffContext, entry: StaffAction, db = unsafeAdminDb()): Promise<void> {
  await db.insert(staffAudit).values({
    id: uuidv7(), staffUserId: staff.userId, action: entry.action, targetType: entry.targetType,
    targetId: entry.targetId ?? null, storeId: entry.storeId ?? null, reason: entry.reason ?? null,
    detail: entry.detail ?? null, requestId: staff.requestId,
  });
  log.info('staff action', { staffUserId: staff.userId, action: entry.action, targetType: entry.targetType, targetId: entry.targetId, storeId: entry.storeId });
}

export type StaffTrailRow = {
  id: string; at: string; staff: string; action: string; targetType: string; targetId: string | null;
  storeId: string | null; reason: string | null;
};

/** The newest staff actions, optionally for one store or one target (a person, say). */
export async function staffTrail(input: { storeId?: string; target?: { type: string; id: string }; limit?: number } = {}): Promise<StaffTrailRow[]> {
  const db = unsafeAdminDb();
  const rows = await db.select().from(staffAudit)
    .where(and(
      input.storeId ? eq(staffAudit.storeId, input.storeId) : undefined,
      input.target ? and(eq(staffAudit.targetType, input.target.type), eq(staffAudit.targetId, input.target.id)) : undefined,
    ))
    .orderBy(desc(staffAudit.createdAt), desc(staffAudit.id)).limit(Math.min(input.limit ?? 50, 200));
  const ids = [...new Set(rows.map((r) => r.staffUserId))];
  const people = ids.length ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids)) : [];
  const email = new Map(people.map((p) => [p.id, p.email]));
  return rows.map((r) => ({
    id: r.id, at: r.createdAt.toISOString(), staff: email.get(r.staffUserId) ?? '—', action: r.action,
    targetType: r.targetType, targetId: r.targetId, storeId: r.storeId, reason: r.reason,
  }));
}
