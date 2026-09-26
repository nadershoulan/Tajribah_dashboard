/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A14 — privacy requests under T22: recorded with an identity check and a 30-day deadline; an
 * export carries the account's data and never its secrets; erasure anonymises, refused for a
 * store owner; a request about nobody is closed with the reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, dataRequests, invitations, notifications, sessions, staffAudit, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { exportDocument, fulfilErasure, fulfilExport, listPrivacyRequests, recordPrivacyRequest, rejectPrivacyRequest } from '@/server/modules/admin/privacy';

setLogLevel('error');
const DAY = 86_400_000;
const STAFF = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });
const CHECK = 'asked from the account email, confirmed by reply';

async function member(harness: TestDb, tenantId: string, email: string, role = 'editor') {
  const id = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(users).values({ id, email, passwordHash: 'pbkdf2$x', fullName: 'Sara', phone: '+966500000001', totpEnabled: true, totpSecretEncrypted: 'v2.sealed.secret', backupCodesHash: ['h1'] } as any);
    await harness.db.insert(tenantMemberships).values({ tenantId, userId: id, role } as any);
  });
  return id;
}

test('recording: an email and an identity check, due in 30 days; a request about nobody is closed with the reason', async () => {
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const staff = STAFF(store.userId);
    const now = new Date('2026-09-27T09:00:00Z');
    await assert.rejects(() => recordPrivacyRequest(staff, { type: 'export', subjectEmail: 'not an email', identityCheck: CHECK }), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => recordPrivacyRequest(staff, { type: 'export', subjectEmail: store.email, identityCheck: 'ok' }), (e: any) => e.code === 'validation_failed', 'how identity was checked');

    const known = await recordPrivacyRequest(staff, { type: 'export', subjectEmail: ` ${store.email.toUpperCase()} `, identityCheck: CHECK }, now);
    assert.equal(known.subjectUserId, store.userId);
    assert.equal(known.dueAt, new Date(now.getTime() + 30 * DAY).toISOString());
    const nobody = await recordPrivacyRequest(staff, { type: 'erase', subjectEmail: 'shopper@example.test', identityCheck: 'shopper emailed support' }, now);
    assert.equal(nobody.subjectUserId, null);
    await assert.rejects(() => fulfilErasure(staff, nobody.id), (e: any) => e.code === 'conflict' && /no account/.test(e.message));
    await rejectPrivacyRequest(staff, nobody.id, 'no personal data held — shoppers are not identified; ask the store');
    await assert.rejects(() => rejectPrivacyRequest(staff, nobody.id, 'twice over now'), (e: any) => e.code === 'conflict');

    const later = new Date(now.getTime() + 31 * DAY);
    const list = await listPrivacyRequests(later);
    assert.deepEqual(list.map((r) => [r.type, r.status, r.overdue]), [['export', 'received', true], ['erase', 'rejected', false]], 'open first; overdue after 30 days');
    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.deepEqual(trail.map((r) => r.action), ['privacy.export_received', 'privacy.erase_received', 'privacy.rejected']);
  } finally { await harness.close(); }
});

test('export: the account, its stores, sign-ins, notifications and actions — never a secret, the IP or a value', async () => {
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const staff = STAFF(store.userId);
    const sara = await member(harness, store.tenantId, 'sara@oud.sa');
    await harness.asAdmin(async () => {
      await harness.db.insert(sessions).values({ userId: sara, expiresAt: new Date(Date.now() + DAY), userAgent: 'Safari', ipHash: 'hashed-ip-value' } as any);
      await harness.db.insert(notifications).values({ tenantId: store.tenantId, userId: sara, type: 't', titleAr: 'عنوان', titleEn: 'Title' } as any);
      await harness.db.insert(auditLogs).values({ tenantId: store.tenantId, actorUserId: sara, actorType: 'user', action: 'update', resourceType: 'product', resourceId: 'p1', changes: { before: { price: 1 }, after: { price: 2 } } } as any);
    });
    const request = await recordPrivacyRequest(staff, { type: 'export', subjectEmail: 'sara@oud.sa', identityCheck: CHECK });
    await assert.rejects(() => fulfilErasure(staff, request.id), (e: any) => e.code === 'conflict', 'an export request is not an erasure');

    const doc: any = await fulfilExport(staff, request.id);
    assert.equal(doc.account.email, 'sara@oud.sa');
    assert.deepEqual(doc.stores.map((s: any) => [s.id, s.role]), [[store.tenantId, 'editor']]);
    assert.equal(doc.signIns.length, 1);
    assert.equal(doc.notifications.length, 1);
    assert.deepEqual(doc.actions.map((a: any) => [a.action, a.record, a.fields]), [['update', 'product', ['price']]]);
    const text = await exportDocument(request.id);
    assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(doc)), 'the kept file is the document');
    for (const never of ['pbkdf2$x', 'v2.sealed.secret', 'hashed-ip-value', '"h1"', '"before"']) assert.ok(!text.includes(never), `never ${never}`);

    const [row] = await harness.asAdmin(() => harness.db.select().from(dataRequests).where(eq(dataRequests.id, request.id)));
    assert.deepEqual([row!.status, row!.handledBy, !!row!.resultStorageKey], ['completed', store.userId, true]);
    await assert.rejects(() => fulfilExport(staff, request.id), (e: any) => e.code === 'conflict', 'closed');
  } finally { await harness.close(); }
});

test('erasure: refused for a store owner; otherwise anonymised, memberships, sessions, notifications and invitations gone, the trail kept', async () => {
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const other = await seedTenant(harness, 'bravo');
    const staff = STAFF(other.userId);
    const owner = await recordPrivacyRequest(staff, { type: 'erase', subjectEmail: store.email, identityCheck: CHECK });
    await assert.rejects(() => fulfilErasure(staff, owner.id), (e: any) => e.code === 'conflict' && /owns/.test(e.message), 'transfer or close the store first');

    const sara = await member(harness, store.tenantId, 'sara@oud.sa');
    await harness.asAdmin(async () => {
      await harness.db.insert(sessions).values({ userId: sara, expiresAt: new Date(Date.now() + DAY) } as any);
      await harness.db.insert(notifications).values({ tenantId: store.tenantId, userId: sara, type: 't', titleAr: 'ع', titleEn: 'T' } as any);
      await harness.db.insert(invitations).values({ tenantId: other.tenantId, email: 'sara@oud.sa', tokenHash: 'x', expiresAt: new Date(Date.now() + DAY), invitedBy: other.userId } as any);
      await harness.db.insert(auditLogs).values({ tenantId: store.tenantId, actorUserId: sara, actorType: 'user', action: 'create', resourceType: 'product' } as any);
    });
    const request = await recordPrivacyRequest(staff, { type: 'erase', subjectEmail: 'sara@oud.sa', identityCheck: CHECK });
    await fulfilErasure(staff, request.id);

    const [after] = await harness.asAdmin(() => harness.db.select().from(users).where(eq(users.id, sara)));
    assert.equal(after!.email, `erased-${sara}@erased.invalid`);
    assert.deepEqual([after!.fullName, after!.phone, after!.totpEnabled, after!.totpSecretEncrypted, after!.backupCodesHash, !!after!.deletedAt], ['', null, false, null, null, true]);
    assert.ok(after!.passwordHash.startsWith('erased$'), 'the old password no longer signs in');
    const count = async (table: any, where: any) => (await harness.asAdmin(() => harness.db.select().from(table).where(where))).length;
    assert.equal(await count(tenantMemberships, eq(tenantMemberships.userId, sara)), 0);
    assert.equal(await count(notifications, eq(notifications.userId, sara)), 0);
    assert.equal(await count(invitations, eq(invitations.email, 'sara@oud.sa')), 0);
    const [session] = await harness.asAdmin(() => harness.db.select().from(sessions).where(eq(sessions.userId, sara)));
    assert.ok(session!.revokedAt, 'signed out everywhere');
    assert.equal(await count(auditLogs, eq(auditLogs.actorUserId, sara)), 1, 'what was done stays; who did it is now anonymous');
    const [row] = await harness.asAdmin(() => harness.db.select().from(dataRequests).where(eq(dataRequests.id, request.id)));
    assert.deepEqual([row!.status, row!.subjectEmail], ['completed', null], 'the register no longer holds the address either');
  } finally { await harness.close(); }
});
