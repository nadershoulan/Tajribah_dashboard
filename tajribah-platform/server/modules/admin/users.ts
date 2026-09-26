/**
 * A5 — people, for staff (ADM-11/12): find anyone by email or name, see which stores they
 * belong to and where they are signed in, and — with a written reason — end every session or
 * reset their two-step sign-in (the lost-phone case).
 *
 * Reads change nothing. Each change and its staff-trail row are one admin transaction. A person
 * is not a store, so the change has no store trail; a two-step reset emails the person instead,
 * because it weakens their account. Staff never act on themselves here: a reset of your own
 * two-step sign-in would lock you out of the console, and should be a colleague's decision.
 */
import { and, count, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { sessions, tenantMemberships, tenants, users } from '@/db/schema';
import { errors } from '@/server/core/errors/problem';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import { staffLog, staffTrail, type StaffContext, type StaffTrailRow } from './access';

export type PersonRow = {
  id: string; email: string; fullName: string; isStaff: boolean; twoFactor: boolean; emailVerified: boolean;
  stores: number; lastLoginAt: string | null; lockedUntil: string | null; createdAt: string;
};

/** ADM-11 — people, newest first; search matches email, name or exact id. Deleted accounts excluded. */
export async function listPeople(input: { q?: string; before?: string; limit?: number } = {}): Promise<{ people: PersonRow[]; next: string | null }> {
  const db = unsafeAdminDb(); // staff read every account (A1)
  const limit = Math.min(input.limit ?? 50, 100);
  const q = input.q?.trim();
  const escaped = q?.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db.select().from(users).where(and(
    isNull(users.deletedAt),
    input.before ? lt(users.id, input.before) : undefined,
    q ? or(ilike(users.email, `%${escaped}%`), ilike(users.fullName, `%${escaped}%`), sql`${users.id}::text = ${q}`) : undefined,
  )).orderBy(desc(users.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const ids = page.map((u) => u.id);
  const counts = ids.length
    ? await db.select({ userId: tenantMemberships.userId, n: count() }).from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(and(inArray(tenantMemberships.userId, ids), isNull(tenants.deletedAt))).groupBy(tenantMemberships.userId)
    : [];
  const stores = new Map(counts.map((c) => [c.userId, Number(c.n)]));
  return {
    people: page.map((u) => ({
      id: u.id, email: u.email, fullName: u.fullName, isStaff: u.isStaff, twoFactor: u.totpEnabled, emailVerified: !!u.emailVerifiedAt,
      stores: stores.get(u.id) ?? 0, lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      lockedUntil: u.lockedUntil?.toISOString() ?? null, createdAt: u.createdAt.toISOString(),
    })),
    next: rows.length > limit ? page.at(-1)!.id : null,
  };
}

export type PersonDetail = {
  /** `lockedUntil` here only while the lock still holds. */
  person: PersonRow & { locale: string; phone: string | null; backupCodesLeft: number };
  stores: { id: string; name: string; nameAr: string | null; slug: string; status: string; role: string; membership: string }[];
  /** Live sessions only. The IP is kept hashed and is not shown. */
  sessions: { id: string; userAgent: string | null; createdAt: string; lastSeenAt: string | null; expiresAt: string }[];
  staffTrail: StaffTrailRow[];
};

/** ADM-12 — one person: their stores, where they are signed in, what staff did to their account. */
export async function personDetail(id: string, now = new Date()): Promise<PersonDetail> {
  const db = unsafeAdminDb();
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user || user.deletedAt) throw errors.notFound('person');
  const stores = await db.select({ tenant: tenants, role: tenantMemberships.role, membership: tenantMemberships.status })
    .from(tenantMemberships).innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(and(eq(tenantMemberships.userId, id), isNull(tenants.deletedAt))).orderBy(tenants.name);
  const live = await db.select().from(sessions)
    .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > ${now.toISOString()}`))
    .orderBy(desc(sessions.createdAt));
  return {
    person: {
      id: user.id, email: user.email, fullName: user.fullName, isStaff: user.isStaff, twoFactor: user.totpEnabled,
      emailVerified: !!user.emailVerifiedAt, stores: stores.length, lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      lockedUntil: user.lockedUntil && user.lockedUntil > now ? user.lockedUntil.toISOString() : null, createdAt: user.createdAt.toISOString(),
      locale: user.locale, phone: user.phone, backupCodesLeft: user.totpEnabled ? (user.backupCodesHash ?? []).length : 0,
    },
    stores: stores.map(({ tenant, role, membership }) => ({ id: tenant.id, name: tenant.name, nameAr: tenant.nameAr, slug: tenant.slug, status: tenant.status, role, membership })),
    sessions: live.map((s) => ({ id: s.id, userAgent: s.userAgent, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt?.toISOString() ?? null, expiresAt: s.expiresAt.toISOString() })),
    staffTrail: await staffTrail({ target: { type: 'user', id } }),
  };
}

export type PersonAction =
  | { type: 'end_sessions'; reason: string }
  | { type: 'reset_two_factor'; reason: string };

/** End every session, or reset two-step sign-in — with a reason, in the staff trail, never on yourself. */
export async function actOnPerson(staff: StaffContext, id: string, action: PersonAction): Promise<{ sessionsEnded: number }> {
  const reason = action.reason.trim();
  if (reason.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  if (id === staff.userId) throw errors.forbidden('ask another staff member to change your own account');

  const result = await unsafeAdminDb().transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
    if (!user || user.deletedAt) throw errors.notFound('person');
    const revoked = async () => (await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: 'admin' })
      .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt))).returning({ id: sessions.id })).length;

    if (action.type === 'end_sessions') {
      const ended = await revoked();
      await staffLog(staff, { action: 'user.sessions_end', targetType: 'user', targetId: id, reason, detail: { ended } }, tx as unknown as Db);
      return { user, sessionsEnded: ended };
    }
    if (!user.totpEnabled) throw errors.conflict('two-step sign-in is already off for this person');
    await tx.update(users).set({ totpEnabled: false, totpSecretEncrypted: null, totpLastStep: null, backupCodesHash: null }).where(eq(users.id, id));
    // Whoever holds a session now keeps nothing they got through the old second step.
    const ended = await revoked();
    await staffLog(staff, { action: 'user.two_factor_reset', targetType: 'user', targetId: id, reason, detail: { ended } }, tx as unknown as Db);
    return { user, sessionsEnded: ended };
  });

  if (action.type === 'reset_two_factor') await sendEmail(result.user.email, EMAIL.twoFactorResetByStaff, {}, result.user.locale);
  return { sessionsEnded: result.sessionsEnded };
}
