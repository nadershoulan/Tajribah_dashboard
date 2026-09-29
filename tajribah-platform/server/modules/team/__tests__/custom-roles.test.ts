/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P8 — custom roles (Enterprise): only the work, never the keys to the store; a member holding one
 * has exactly its permissions, from the next request after any change; leaving the plan falls back
 * to viewer (the least), never more; a role still held cannot be deleted; another store's role
 * cannot be given; the bell reaches whoever the role lets act.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { notifications, planFeatures, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { MAX_CUSTOM_ROLES } from '@/lib/permissions';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { createTestDb, enablePlanFeature, seedTenant, type TestDb } from '@/server/testing/harness';
import { notifyIn } from '@/server/modules/notifications/service';
import {
  assignCustomRole, changeRole, createCustomRole, deleteCustomRole, listCustomRoles, listTeam, updateCustomRole,
} from '@/server/modules/team/service';

setLogLevel('error');

async function store(harness: TestDb, name = 'alpha', feature = true) {
  const seeded = await seedTenant(harness, name);
  if (feature) await enablePlanFeature(harness, 'starter', 'custom_roles');
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}
async function member(harness: TestDb, tenantId: string, email: string, role = 'editor') {
  const userId = uuidv7();
  const membershipId = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(users).values({ id: userId, email, passwordHash: 'x', fullName: email.split('@')[0] } as any);
    await harness.db.insert(tenantMemberships).values({ id: membershipId, tenantId, userId, role, status: 'active' } as any);
  });
  const ctx = () => buildTenantContext({ actor: { userId, email, isStaff: false }, tenantId, requestId: `r-${email}` });
  return { userId, membershipId, ctx };
}
const PHOTOGRAPHER = { name: 'Photographer', permissions: ['models:read', 'models:write', 'products:read'] };

test('only on the plan; only the work — never people, settings, billing, keys, connections or the store itself', async () => {
  const harness = await createTestDb();
  try {
    const off = await store(harness, 'alpha', false);
    await assert.rejects(() => createCustomRole(off.ctx, PHOTOGRAPHER), (e: any) => e.code === 'plan_required');
    await enablePlanFeature(harness, 'starter', 'custom_roles');
    const bad = (input: any, field: string) => assert.rejects(() => createCustomRole(off.ctx, { ...PHOTOGRAPHER, ...input }),
      (e: any) => e.code === 'validation_failed' && field in e.errors);
    await bad({ name: 'x' }, 'name');
    await bad({ name: 'Admin' }, 'name');
    await bad({ permissions: [] }, 'permissions');
    for (const p of ['team:manage', 'team:invite', 'settings:write', 'billing:write', 'billing:read', 'api_keys:manage', 'connections:write', 'tenant:delete']) {
      await bad({ permissions: ['products:read', p] }, 'permissions');
    }
    const made = await createCustomRole(off.ctx, { name: ' Photographer ', permissions: ['models:write', 'models:read', 'models:write', 'products:read'] });
    assert.deepEqual([made.name, made.permissions, made.members], ['Photographer', ['products:read', 'models:read', 'models:write'], 0]);
    await bad({ name: 'PHOTOGRAPHER' }, 'name');
    for (let i = 1; i < MAX_CUSTOM_ROLES; i++) await createCustomRole(off.ctx, { name: `Role ${i}`, permissions: ['products:read'] });
    await assert.rejects(() => createCustomRole(off.ctx, { name: 'One more', permissions: ['products:read'] }), (e: any) => e.code === 'conflict');
  } finally { await harness.close(); }
});

test('a member holding a role has exactly its permissions — changed from the next request; viewer underneath', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness);
    const sara = await member(harness, a.tenantId, 'sara@example.test', 'editor');
    const role = await createCustomRole(a.ctx, PHOTOGRAPHER);
    await assignCustomRole(a.ctx, sara.membershipId, role.id);

    let ctx = await sara.ctx();
    assert.deepEqual([...ctx.permissions].sort(), ['models:read', 'models:write', 'products:read']);
    ctx.require('models:write');
    assert.throws(() => ctx.require('products:write'), (e: any) => e.code === 'forbidden', 'the editor she was can, the photographer cannot');
    const [row] = await harness.asAdmin(() => harness.db.select().from(tenantMemberships).where(eq(tenantMemberships.id, sara.membershipId))) as any[];
    assert.equal(row.role, 'viewer', 'viewer underneath');
    const listed = (await listTeam(a.ctx)).find((m) => m.id === sara.membershipId)!;
    assert.deepEqual(listed.customRole, { id: role.id, name: 'Photographer' });
    assert.equal((await listCustomRoles(a.ctx))[0]!.members, 1);

    await updateCustomRole(a.ctx, role.id, { permissions: ['models:read', 'models:write', 'models:publish'] });
    ctx = await sara.ctx();
    ctx.require('models:publish');
    assert.equal(ctx.can('products:read'), false, 'taken away at once');

    await changeRole(a.ctx, sara.membershipId, 'analyst');
    ctx = await sara.ctx();
    assert.equal(ctx.role, 'analyst');
    assert.ok(ctx.can('analytics:export') && !ctx.can('models:write'), 'a built-in role replaces the custom one');
    assert.equal((await listTeam(a.ctx)).find((m) => m.id === sara.membershipId)!.customRole, null);
  } finally { await harness.close(); }
});

test('leaving the plan falls back to viewer — the least, never the role held before', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness);
    const sara = await member(harness, a.tenantId, 'sara@example.test', 'admin');
    const role = await createCustomRole(a.ctx, PHOTOGRAPHER);
    await assignCustomRole(a.ctx, sara.membershipId, role.id);
    await harness.asAdmin(() => harness.db.delete(planFeatures).where(eq(planFeatures.featureKey, 'custom_roles')));
    const ctx = await sara.ctx();
    assert.equal(ctx.can('products:read'), true);
    assert.equal(ctx.can('models:write'), false, 'the custom role no longer applies');
    assert.equal(ctx.can('team:manage'), false, 'and she is not an admin again');
  } finally { await harness.close(); }
});

test('who may give a role, and to whom; a held role cannot be deleted; another store\'s role cannot be given', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness);
    const b = await store(harness, 'bravo');
    const role = await createCustomRole(a.ctx, PHOTOGRAPHER);
    const foreign = await createCustomRole(b.ctx, { name: 'Theirs', permissions: ['products:read'] });
    const sara = await member(harness, a.tenantId, 'sara@example.test', 'editor');
    const ali = await member(harness, a.tenantId, 'ali@example.test', 'admin');
    const [owner] = await harness.asAdmin(() => harness.db.select().from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, a.tenantId), eq(tenantMemberships.role, 'owner')))) as any[];

    await assert.rejects(() => assignCustomRole(a.ctx, owner.id, role.id), (e: any) => e.code === 'forbidden');
    const aliCtx = await ali.ctx();
    const saraCtx = await sara.ctx();
    await assert.rejects(() => assignCustomRole(aliCtx, ali.membershipId, role.id), (e: any) => e.code === 'forbidden', 'not yourself');
    await assert.rejects(() => assignCustomRole(a.ctx, sara.membershipId, foreign.id), (e: any) => e.code === 'not_found', 'another store\'s role does not exist here');
    await assert.rejects(() => assignCustomRole(saraCtx, ali.membershipId, role.id), (e: any) => e.code === 'forbidden', 'an editor cannot give roles');

    await assignCustomRole(await ali.ctx(), sara.membershipId, role.id);
    await assert.rejects(() => deleteCustomRole(a.ctx, role.id), (e: any) => e.code === 'conflict' && /1 member still holds this role/.test(e.message));
    await changeRole(a.ctx, sara.membershipId, 'viewer');
    await deleteCustomRole(a.ctx, role.id);
    assert.equal((await listCustomRoles(a.ctx)).length, 0);
  } finally { await harness.close(); }
});

test('the bell reaches whoever a custom role lets act', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness);
    const sara = await member(harness, a.tenantId, 'sara@example.test', 'viewer');
    const role = await createCustomRole(a.ctx, PHOTOGRAPHER);
    await assignCustomRole(a.ctx, sara.membershipId, role.id);
    await withTenant(a.tenantId, (db) => notifyIn(db, { type: 'model_ready', permission: 'models:write', title: { ar: 'جاهز', en: 'Ready' } }));
    const told = await harness.asAdmin(() => harness.db.select().from(notifications).where(eq(notifications.userId, sara.userId))) as any[];
    assert.equal(told.length, 1, 'a viewer by role, a photographer by her custom role');
  } finally { await harness.close(); }
});
