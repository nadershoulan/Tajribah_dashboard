/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, invitations, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { planByCode } from '@/lib/plans';
import { setLogLevel } from '@/server/core/observability/log';
import { setEmailSender } from '@/server/core/notify/notify';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { acceptInvitation, changeRole, invite, listTeam, removeMember, revokeInvitation } from '@/server/modules/team/service';

setLogLevel('error');
const SECRET = 's'.repeat(40);
const CONFIG = { authSecret: SECRET, appUrl: 'https://app.example.test' };
const code = (e: any) => e.code;
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);

const sent: { to: string; subject: string; text: string }[] = [];
setEmailSender({ async send(message: any) { sent.push(message); } } as any);
const linkTokenFor = (email: string) => {
  const mail = [...sent].reverse().find((m) => m.to === email);
  return mail?.text.match(/\/invite\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
};

async function account(harness: TestDb, email: string): Promise<string> {
  const id = uuidv7();
  await admin(harness, () => harness.db.insert(users).values({ id, email, passwordHash: 'x', fullName: email.split('@')[0] } as any));
  return id;
}

async function member(harness: TestDb, tenantId: string, email: string, role: string) {
  const userId = await account(harness, email);
  const [row] = await admin(harness, () => harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId, role, status: 'active' } as any).returning()) as any[];
  const ctx = await buildTenantContext({ actor: { userId, email, isStaff: false }, tenantId, requestId: `req-${email}` });
  return { userId, membershipId: row.id, ctx };
}

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

test('invite → email with a link → accept as that address → member; the token is stored only as a hash', async () => {
  const harness = await createTestDb();
  try {
    const owner = await store(harness, 'alpha');
    const { id } = await invite(owner.ctx, { email: '  Sara@Example.test ', role: 'editor' }, CONFIG);
    const token = linkTokenFor('sara@example.test');
    assert.ok(token, 'the email carries the link');
    assert.match(sent.at(-1)!.text, /https:\/\/app\.example\.test\/invite\//);
    const [row] = await admin(harness, () => harness.db.select().from(invitations).where(eq(invitations.id, id))) as any[];
    assert.notEqual(row.tokenHash, token, 'only the hash is stored');
    assert.ok(!JSON.stringify(row).includes(token!));

    let team = await listTeam(owner.ctx);
    assert.deepEqual(team.map((m) => [m.email, m.status]).find(([e]) => e === 'sara@example.test'), ['sara@example.test', 'invited']);

    const stranger = await account(harness, 'mallory@example.test');
    await assert.rejects(() => acceptInvitation({ token: token!, userId: stranger, authSecret: SECRET }), (e: any) => code(e) === 'not_found', 'the link alone is not enough');
    const sara = await account(harness, 'sara@example.test');
    const joined = await acceptInvitation({ token: token!, userId: sara, authSecret: SECRET });
    assert.equal(joined.tenantId, owner.tenantId);
    await assert.rejects(() => acceptInvitation({ token: token!, userId: sara, authSecret: SECRET }), (e: any) => code(e) === 'not_found', 'single use');

    team = await listTeam(owner.ctx);
    const saraRow = team.find((m) => m.email === 'sara@example.test')!;
    assert.deepEqual([saraRow.role, saraRow.status], ['editor', 'active']);
    const ctx = await buildTenantContext({ actor: { userId: sara, email: 'sara@example.test', isStaff: false }, tenantId: owner.tenantId, requestId: 'r' });
    assert.equal(ctx.role, 'editor');
    const trail = await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.tenantId, owner.tenantId))) as any[];
    assert.ok(trail.some((r) => r.action === 'invite') && trail.some((r) => r.action === 'create' && r.resourceType === 'team_member'));
  } finally { await harness.close(); }
});

test('the invitation email is in the language the inviter chose; Arabic by default', async () => {
  const harness = await createTestDb();
  try {
    const owner = await store(harness, 'alpha');
    await invite(owner.ctx, { email: 'lee@example.test', role: 'viewer' }, CONFIG);
    assert.match(sent.at(-1)!.text, /دُعيت/);
    await invite(owner.ctx, { email: 'lee@example.test', role: 'viewer', lang: 'en' }, CONFIG);
    assert.match(sent.at(-1)!.subject, /You are invited/, 'the inviter chose English for this person');
  } finally { await harness.close(); }
});

test('expired, revoked and re-sent invitations; nobody is invited twice or as owner', async () => {
  const harness = await createTestDb();
  try {
    const owner = await store(harness, 'alpha');
    const first = await invite(owner.ctx, { email: 'a@example.test', role: 'viewer' }, CONFIG);
    const oldToken = linkTokenFor('a@example.test')!;
    const again = await invite(owner.ctx, { email: 'a@example.test', role: 'analyst' }, CONFIG);
    assert.equal(again.id, first.id, 're-inviting replaces the open invitation');
    const user = await account(harness, 'a@example.test');
    await assert.rejects(() => acceptInvitation({ token: oldToken, userId: user, authSecret: SECRET }), (e: any) => code(e) === 'not_found', 'the old link stops working');

    await revokeInvitation(owner.ctx, first.id);
    await assert.rejects(() => acceptInvitation({ token: linkTokenFor('a@example.test')!, userId: user, authSecret: SECRET }), (e: any) => code(e) === 'not_found');

    await invite(owner.ctx, { email: 'late@example.test', role: 'viewer' }, CONFIG);
    await admin(harness, () => harness.db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) } as any).where(eq(invitations.email, 'late@example.test')));
    const late = await account(harness, 'late@example.test');
    await assert.rejects(() => acceptInvitation({ token: linkTokenFor('late@example.test')!, userId: late, authSecret: SECRET }), (e: any) => code(e) === 'not_found');

    await assert.rejects(() => invite(owner.ctx, { email: 'boss@example.test', role: 'owner' }, CONFIG), (e: any) => code(e) === 'validation_failed');
    await assert.rejects(() => invite(owner.ctx, { email: 'not-an-email', role: 'viewer' }, CONFIG), (e: any) => code(e) === 'validation_failed');
    await assert.rejects(() => invite(owner.ctx, { email: owner.email, role: 'viewer' }, CONFIG), (e: any) => code(e) === 'conflict', 'already on the team');
  } finally { await harness.close(); }
});

test('the plan\'s seats count members and open invitations', async () => {
  const harness = await createTestDb();
  try {
    const owner = await store(harness, 'alpha');
    const seats = planByCode('starter').limits.team_members;
    for (let i = 1; i < seats; i++) await invite(owner.ctx, { email: `p${i}@example.test`, role: 'viewer' }, CONFIG);
    await assert.rejects(() => invite(owner.ctx, { email: 'one-too-many@example.test', role: 'viewer' }, CONFIG), (e: any) => code(e) === 'quota_exceeded');
  } finally { await harness.close(); }
});

test('roles: nobody grants above themselves, touches the owner, or changes themselves; removal is immediate', async () => {
  const harness = await createTestDb();
  try {
    const owner = await store(harness, 'alpha');
    const adminM = await member(harness, owner.tenantId, 'admin@example.test', 'admin');
    const editor = await member(harness, owner.tenantId, 'ed@example.test', 'editor');
    const [ownerRow] = await admin(harness, () => harness.db.select().from(tenantMemberships).where(eq(tenantMemberships.userId, owner.userId))) as any[];

    await changeRole(adminM.ctx, editor.membershipId, 'analyst');
    await assert.rejects(() => changeRole(adminM.ctx, ownerRow.id, 'viewer'), (e: any) => code(e) === 'forbidden', 'the owner is untouchable');
    await assert.rejects(() => changeRole(adminM.ctx, adminM.membershipId, 'viewer'), (e: any) => code(e) === 'forbidden', 'not yourself');
    await assert.rejects(() => changeRole(owner.ctx, editor.membershipId, 'owner'), (e: any) => code(e) === 'validation_failed', 'no second owner');
    await assert.rejects(() => changeRole(editor.ctx, adminM.membershipId, 'viewer'), (e: any) => code(e) === 'forbidden', 'an analyst cannot manage');
    await assert.rejects(() => removeMember(adminM.ctx, ownerRow.id), (e: any) => code(e) === 'forbidden');
    // A second owner row (only possible by hand) is still untouchable — even for the owner.
    const second = await member(harness, owner.tenantId, 'owner2@example.test', 'owner');
    await assert.rejects(() => removeMember(owner.ctx, second.membershipId), (e: any) => code(e) === 'forbidden');
    await assert.rejects(() => changeRole(owner.ctx, second.membershipId, 'viewer'), (e: any) => code(e) === 'forbidden');
    await assert.rejects(() => removeMember(adminM.ctx, adminM.membershipId), (e: any) => code(e) === 'forbidden');

    const other = await member(harness, owner.tenantId, 'admin2@example.test', 'admin');
    await changeRole(owner.ctx, other.membershipId, 'viewer');
    await removeMember(adminM.ctx, editor.membershipId);
    await assert.rejects(
      () => buildTenantContext({ actor: { userId: editor.userId, email: 'ed@example.test', isStaff: false }, tenantId: owner.tenantId, requestId: 'r' }),
      (e: any) => code(e) === 'not_found', 'the next request after removal has no access',
    );
    const trail = await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.tenantId, owner.tenantId))) as any[];
    assert.equal(trail.filter((r) => r.action === 'role_change').length, 2);
    assert.equal(trail.filter((r) => r.action === 'delete' && r.resourceType === 'team_member').length, 1);
  } finally { await harness.close(); }
});

test('another store cannot see, invite into, change or remove this store\'s team', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const b = await store(harness, 'beta');
    const { id } = await invite(a.ctx, { email: 'x@example.test', role: 'viewer' }, CONFIG); // Starter: 2 seats
    const ed = await member(harness, a.tenantId, 'ed@example.test', 'editor');
    assert.ok((await listTeam(b.ctx)).every((m) => m.email !== 'ed@example.test' && m.email !== 'x@example.test'));
    await assert.rejects(() => changeRole(b.ctx, ed.membershipId, 'viewer'), (e: any) => code(e) === 'not_found');
    await assert.rejects(() => removeMember(b.ctx, ed.membershipId), (e: any) => code(e) === 'not_found');
    await assert.rejects(() => revokeInvitation(b.ctx, id), (e: any) => code(e) === 'not_found');
  } finally { await harness.close(); }
});
