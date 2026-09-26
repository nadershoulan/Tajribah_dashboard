/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A5 — staff find a person, see their stores and live sessions, and — with a reason, never on
 * themselves — end every session or reset two-step sign-in (which also emails the person).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { sessions, staffAudit, tenantMemberships, tenants, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setEmailSender, type EmailMessage } from '@/server/core/notify/notify';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { actOnPerson, listPeople, personDetail } from '@/server/modules/admin/users';

setLogLevel('error');
const DAY = 86_400_000;
const STAFF = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });

async function person(harness: TestDb, email: string, fields: Record<string, unknown> = {}) {
  const id = uuidv7();
  await harness.asAdmin(() => harness.db.insert(users).values({ id, email, passwordHash: 'x', fullName: email.split('@')[0], ...fields } as any));
  return id;
}
const session = (harness: TestDb, userId: string, fields: Record<string, unknown> = {}) =>
  harness.asAdmin(() => harness.db.insert(sessions).values({ userId, expiresAt: new Date(Date.now() + 30 * DAY), userAgent: 'Safari', ...fields } as any));

test('the list: newest first, search by email / name / id (% and _ are characters), paging, store counts, no deleted accounts', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha'); // its owner is the oldest person
    const sara = await person(harness, 'sara@oud.sa', { fullName: 'Sara Al-Harbi' });
    const odd = await person(harness, 'x_100%@example.test');
    const gone = await person(harness, 'gone@example.test', { deletedAt: new Date() });
    await harness.asAdmin(() => harness.db.insert(tenantMemberships).values({ tenantId: store.tenantId, userId: sara, role: 'editor' } as any));

    const all = await listPeople();
    assert.deepEqual(all.people.map((p) => p.id), [odd, sara, store.userId], 'newest first, the deleted account absent');
    assert.ok(!all.people.some((p) => p.id === gone));
    assert.deepEqual((await listPeople({ q: 'harbi' })).people.map((p) => p.id), [sara], 'the name');
    assert.deepEqual((await listPeople({ q: 'OUD.SA' })).people.map((p) => p.id), [sara], 'the email, any case');
    assert.deepEqual((await listPeople({ q: sara })).people.map((p) => p.id), [sara], 'the id');
    assert.deepEqual((await listPeople({ q: '100%' })).people.map((p) => p.id), [odd], '% is a character');
    assert.deepEqual((await listPeople({ q: 'x_' })).people.map((p) => p.id), [odd], '_ is a character');
    assert.deepEqual((await listPeople({ q: 'a_' })).people, []);
    assert.equal(all.people.find((p) => p.id === sara)!.stores, 1);
    assert.equal(all.people.find((p) => p.id === odd)!.stores, 0);

    const first = await listPeople({ limit: 2 });
    assert.equal(first.people.length, 2);
    const second = await listPeople({ limit: 2, before: first.next! });
    assert.deepEqual(second.people.map((p) => p.id), [store.userId]);
    assert.equal(second.next, null);
  } finally { await harness.close(); }
});

test('one person: stores (deleted store hidden), live sessions only, the staff actions on them', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const b = await seedTenant(harness, 'bravo');
    await harness.asAdmin(async () => {
      await harness.db.insert(tenantMemberships).values({ tenantId: b.tenantId, userId: a.userId, role: 'viewer' } as any);
      await harness.db.update(tenants).set({ deletedAt: new Date() }).where(eq(tenants.id, b.tenantId));
    });
    await session(harness, a.userId);
    await session(harness, a.userId, { revokedAt: new Date(), revokedReason: 'logout' });
    await session(harness, a.userId, { expiresAt: new Date(Date.now() - DAY) });

    const detail = await personDetail(a.userId);
    assert.deepEqual(detail.stores.map((s) => [s.id, s.role]), [[a.tenantId, 'owner']]);
    assert.equal((await listPeople({ q: a.userId })).people[0]!.stores, 1, 'the list does not count the deleted store either');
    assert.equal(detail.sessions.length, 1, 'signed out and expired sessions are not live');
    assert.equal(detail.person.twoFactor, false);
    await harness.asAdmin(() => harness.db.update(users).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, a.userId)));
    assert.equal((await personDetail(a.userId)).person.lockedUntil, null, 'a lock that has run out is not shown');
    await harness.asAdmin(() => harness.db.update(users).set({ lockedUntil: new Date(Date.now() + 60_000) }).where(eq(users.id, a.userId)));
    assert.ok((await personDetail(a.userId)).person.lockedUntil, 'a lock in force is');
    assert.ok(!('ipHash' in detail.sessions[0]!));
    await assert.rejects(() => personDetail(uuidv7()), (e: any) => e.code === 'not_found');
  } finally { await harness.close(); }
});

test('end sessions and reset two-step: a reason, the staff trail, never yourself; a reset ends sessions and emails the person', async () => {
  const harness = await createTestDb();
  const sent: EmailMessage[] = [];
  setEmailSender({ send: async (m) => { sent.push(m); } });
  try {
    const staffId = await person(harness, 'staff@tajribah.test', { isStaff: true, totpEnabled: true });
    const staff = STAFF(staffId);
    const who = await person(harness, 'lost-phone@oud.sa', { locale: 'ar', totpEnabled: true, totpSecretEncrypted: 'sealed', totpLastStep: 5, backupCodesHash: ['a', 'b'] });
    await session(harness, who);
    await session(harness, who);
    const other = await person(harness, 'other@oud.sa');
    await session(harness, other);
    const live = async (id: string) => (await personDetail(id)).sessions.length;

    await assert.rejects(() => actOnPerson(staff, who, { type: 'end_sessions', reason: 'ok' }), (e: any) => e.code === 'validation_failed', 'a reason is required');
    await assert.rejects(() => actOnPerson(staff, staffId, { type: 'reset_two_factor', reason: 'my own phone is lost' }), (e: any) => e.code === 'forbidden', 'not on yourself');
    await assert.rejects(() => actOnPerson(staff, uuidv7(), { type: 'end_sessions', reason: 'nobody at all' }), (e: any) => e.code === 'not_found');

    assert.deepEqual(await actOnPerson(staff, who, { type: 'end_sessions', reason: 'laptop stolen, per the owner' }), { sessionsEnded: 2 });
    assert.equal(await live(who), 0);
    assert.equal(await live(other), 1, 'nobody else signed out');
    const [revoked] = await harness.asAdmin(() => harness.db.select().from(sessions).where(eq(sessions.userId, who)).limit(1));
    assert.equal(revoked!.revokedReason, 'admin');
    assert.equal(sent.length, 0, 'ending sessions sends nothing');

    await session(harness, who);
    assert.deepEqual(await actOnPerson(staff, who, { type: 'reset_two_factor', reason: 'lost phone, identity checked on a call' }), { sessionsEnded: 1 });
    const [after] = await harness.asAdmin(() => harness.db.select().from(users).where(eq(users.id, who)));
    assert.deepEqual([after!.totpEnabled, after!.totpSecretEncrypted, after!.totpLastStep, after!.backupCodesHash], [false, null, null, null]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, 'lost-phone@oud.sa');
    assert.match(sent[0]!.subject, /التحقق بخطوتين/, 'in their language');
    await assert.rejects(() => actOnPerson(staff, who, { type: 'reset_two_factor', reason: 'twice in a row' }), (e: any) => e.code === 'conflict');

    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.deepEqual(trail.map((r) => [r.action, r.targetType, r.targetId, r.reason, (r.detail as any).ended]), [
      ['user.sessions_end', 'user', who, 'laptop stolen, per the owner', 2],
      ['user.two_factor_reset', 'user', who, 'lost phone, identity checked on a call', 1],
    ], 'refusals leave no row');
    assert.deepEqual((await personDetail(who)).staffTrail.map((r) => r.action), ['user.two_factor_reset', 'user.sessions_end']);
    assert.deepEqual((await personDetail(other)).staffTrail, [], 'only this person’s rows');
  } finally { await harness.close(); }
});
