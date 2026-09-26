/**
 * A14 — privacy requests (PDPL), under Tajribah's working rules (docs/DECISIONS.md T22).
 *
 * A person asks support for a copy of their account data (export) or for it to be removed
 * (erasure). Staff record the request with how they checked who is asking; it is due 30 days
 * later. Export writes one private JSON snapshot; erasure anonymises the account, refused while
 * the person owns a store. Every step is in the staff trail with a reason.
 *
 * Admin handle throughout: the register is platform data (a request about an account belongs
 * to no store), and erasure reaches every store the person belongs to.
 */
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { auditLogs, dataRequests, invitations, notifications, sessions, tenantMemberships, tenants, users, verificationTokens } from '@/db/schema';
import { secret, uuidv7 } from '@/lib/ids';
import { errors } from '@/server/core/errors/problem';
import { storage } from '@/server/core/storage/storage';
import { staffLog, type StaffContext } from './access';

const DAY = 86_400_000;
/** T22: the PDPL response period. */
export const RESPONSE_DAYS = 30;

type Kind = 'export' | 'erase';
type Status = 'received' | 'processing' | 'completed' | 'rejected';
export type PrivacyRequest = {
  id: string; type: Kind; status: Status; subjectEmail: string | null; subjectUserId: string | null;
  identityCheck: string | null; note: string | null; receivedAt: string; dueAt: string | null; completedAt: string | null;
  overdue: boolean; hasExport: boolean;
};

const view = (r: typeof dataRequests.$inferSelect, now: Date): PrivacyRequest => ({
  id: r.id, type: r.type, status: r.status, subjectEmail: r.subjectEmail, subjectUserId: r.subjectUserId,
  identityCheck: r.identityCheck, note: r.note, receivedAt: r.createdAt.toISOString(), dueAt: r.dueAt?.toISOString() ?? null,
  completedAt: r.completedAt?.toISOString() ?? null,
  overdue: (r.status === 'received' || r.status === 'processing') && !!r.dueAt && r.dueAt.getTime() < now.getTime(),
  hasExport: !!r.resultStorageKey,
});

function needText(value: string, field: string, min = 5): string {
  const v = value.trim();
  if (v.length < min) throw errors.validation({ [field]: ['say it in a few words'] });
  return v;
}

/** Open requests first (soonest due first), then the rest newest first. */
export async function listPrivacyRequests(now = new Date()): Promise<PrivacyRequest[]> {
  const db = unsafeAdminDb();
  const open = await db.select().from(dataRequests).where(inArray(dataRequests.status, ['received', 'processing'])).orderBy(asc(dataRequests.dueAt)).limit(200);
  const closed = await db.select().from(dataRequests).where(inArray(dataRequests.status, ['completed', 'rejected'])).orderBy(desc(dataRequests.id)).limit(100);
  return [...open, ...closed].map((r) => view(r, now));
}

/** Record a request made to support. The subject is found by exact email (any case); unknown is allowed — it is answered too. */
export async function recordPrivacyRequest(staff: StaffContext, input: { type: Kind; subjectEmail: string; identityCheck: string; note?: string | null }, now = new Date()): Promise<PrivacyRequest> {
  const email = input.subjectEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw errors.validation({ subjectEmail: ['an email address'] });
  const identityCheck = needText(input.identityCheck, 'identityCheck');
  return unsafeAdminDb().transaction(async (tx) => {
    const [person] = await tx.select({ id: users.id }).from(users).where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);
    const [row] = await tx.insert(dataRequests).values({
      id: uuidv7(), tenantId: null, type: input.type, requestedBy: staff.userId, subjectEmail: email, subjectUserId: person?.id ?? null,
      status: 'received', dueAt: new Date(now.getTime() + RESPONSE_DAYS * DAY), identityCheck, note: input.note?.trim() || null,
      createdAt: now, updatedAt: now,
    }).returning();
    await staffLog(staff, { action: `privacy.${input.type}_received`, targetType: 'data_request', targetId: row!.id, reason: identityCheck, detail: { subjectFound: !!person } }, tx as unknown as Db);
    return view(row!, now);
  });
}

async function openRequest(tx: Db, id: string, type: Kind) {
  const [row] = await tx.select().from(dataRequests).where(eq(dataRequests.id, id)).for('update');
  if (!row) throw errors.notFound('privacy request');
  if (row.type !== type) throw errors.conflict(`this is a${type === 'erase' ? 'n export' : 'n erasure'} request`);
  if (row.status === 'completed' || row.status === 'rejected') throw errors.conflict('this request is already closed');
  if (!row.subjectUserId) throw errors.conflict('no account has this email — close the request as "no personal data held"');
  return row;
}

export const exportKey = (id: string) => `p/privacy/${id}/export.json`;

/** Everything Tajribah holds about one account (T22), as one document. Secrets are never included. */
async function exportOf(db: Db, userId: string, now: Date): Promise<Record<string, unknown>> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const stores = await db.select({ id: tenants.id, name: tenants.name, nameAr: tenants.nameAr, role: tenantMemberships.role, status: tenantMemberships.status, since: tenantMemberships.createdAt })
    .from(tenantMemberships).innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId)).where(eq(tenantMemberships.userId, userId));
  const signIns = await db.select({ created: sessions.createdAt, lastSeen: sessions.lastSeenAt, device: sessions.userAgent, ended: sessions.revokedAt })
    .from(sessions).where(eq(sessions.userId, userId)).orderBy(desc(sessions.createdAt)).limit(500);
  const notes = await db.select({ at: notifications.createdAt, titleAr: notifications.titleAr, titleEn: notifications.titleEn, read: notifications.readAt })
    .from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(1000);
  const actions = await db.select({ at: auditLogs.createdAt, storeId: auditLogs.tenantId, action: auditLogs.action, record: auditLogs.resourceType, recordId: auditLogs.resourceId, changes: auditLogs.changes })
    .from(auditLogs).where(eq(auditLogs.actorUserId, userId)).orderBy(desc(auditLogs.createdAt)).limit(5000);
  return {
    generatedAt: now.toISOString(),
    controller: 'SRO Company (Tajribah)',
    account: {
      id: user!.id, email: user!.email, fullName: user!.fullName, phone: user!.phone, locale: user!.locale,
      emailVerifiedAt: user!.emailVerifiedAt, twoStepSignIn: user!.totpEnabled, createdAt: user!.createdAt, lastLoginAt: user!.lastLoginAt,
    },
    stores,
    signIns,
    notifications: notes,
    actions: actions.map((a) => ({ ...a, changes: undefined, fields: [...new Set([...Object.keys(a.changes?.before ?? {}), ...Object.keys(a.changes?.after ?? {})])].sort() })),
  };
}

/** Build the export snapshot, keep it privately, close the request. Returns the document. */
export async function fulfilExport(staff: StaffContext, id: string, now = new Date()): Promise<Record<string, unknown>> {
  return unsafeAdminDb().transaction(async (tx) => {
    const row = await openRequest(tx as unknown as Db, id, 'export');
    const document = await exportOf(tx as unknown as Db, row.subjectUserId!, now);
    await storage().put(exportKey(id), JSON.stringify(document, null, 2), { contentType: 'application/json' });
    await tx.update(dataRequests).set({ status: 'completed', completedAt: now, resultStorageKey: exportKey(id), handledBy: staff.userId, updatedAt: now }).where(eq(dataRequests.id, id));
    await staffLog(staff, { action: 'privacy.export_completed', targetType: 'data_request', targetId: id, reason: 'export prepared', detail: { stores: (document.stores as unknown[]).length } }, tx as unknown as Db);
    return document;
  });
}

/** The kept export, for staff to send. */
export async function exportDocument(id: string): Promise<string> {
  const [row] = await unsafeAdminDb().select().from(dataRequests).where(eq(dataRequests.id, id)).limit(1);
  if (!row?.resultStorageKey) throw errors.notFound('export');
  const object = await storage().get(row.resultStorageKey);
  if (!object) throw errors.notFound('export');
  return new Response(object.body).text();
}

/** Anonymise the account (T22). Refused while the person owns a live store. */
export async function fulfilErasure(staff: StaffContext, id: string, now = new Date()): Promise<void> {
  await unsafeAdminDb().transaction(async (tx) => {
    const row = await openRequest(tx as unknown as Db, id, 'erase');
    const userId = row.subjectUserId!;
    const owned = await tx.select({ name: tenants.name }).from(tenantMemberships).innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.role, 'owner'), eq(tenantMemberships.status, 'active'), isNull(tenants.deletedAt)));
    if (owned.length) throw errors.conflict(`this person owns ${owned.map((o) => o.name).join(', ')} — transfer or close the store first`);
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    await tx.update(users).set({
      email: `erased-${userId}@erased.invalid`, fullName: '', phone: null, phoneVerifiedAt: null, avatarUrl: null,
      passwordHash: `erased$${secret(24)}`, totpEnabled: false, totpSecretEncrypted: null, totpLastStep: null, backupCodesHash: null,
      isStaff: false, deletedAt: now, updatedAt: now,
    }).where(eq(users.id, userId));
    await tx.delete(tenantMemberships).where(eq(tenantMemberships.userId, userId));
    await tx.update(sessions).set({ revokedAt: now, revokedReason: 'admin' }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await tx.delete(notifications).where(eq(notifications.userId, userId));
    await tx.delete(verificationTokens).where(eq(verificationTokens.userId, userId));
    if (user?.email) await tx.delete(invitations).where(and(eq(invitations.email, user.email), isNull(invitations.acceptedAt)));
    await tx.update(dataRequests).set({ status: 'completed', completedAt: now, handledBy: staff.userId, subjectEmail: null, updatedAt: now }).where(eq(dataRequests.id, id));
    await staffLog(staff, { action: 'privacy.erase_completed', targetType: 'data_request', targetId: id, reason: 'account anonymised', detail: null }, tx as unknown as Db);
  });
}

/** Close a request without acting — with the reason sent to the person (e.g. no personal data held). */
export async function rejectPrivacyRequest(staff: StaffContext, id: string, reason: string, now = new Date()): Promise<void> {
  const why = needText(reason, 'reason');
  await unsafeAdminDb().transaction(async (tx) => {
    const [row] = await tx.select().from(dataRequests).where(eq(dataRequests.id, id)).for('update');
    if (!row) throw errors.notFound('privacy request');
    if (row.status === 'completed' || row.status === 'rejected') throw errors.conflict('this request is already closed');
    await tx.update(dataRequests).set({ status: 'rejected', completedAt: now, handledBy: staff.userId, note: why, updatedAt: now }).where(eq(dataRequests.id, id));
    await staffLog(staff, { action: 'privacy.rejected', targetType: 'data_request', targetId: id, reason: why }, tx as unknown as Db);
  });
}
