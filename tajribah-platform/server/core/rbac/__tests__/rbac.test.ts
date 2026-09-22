/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { PERMISSIONS, ROLE_PERMISSIONS, type MemberRole } from '@/lib/permissions';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { problemResponse } from '@/server/core/errors/problem';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';

async function member(harness: TestDb, tenantId: string, role: MemberRole) {
  const userId = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(users).values({ id: userId, email: `${role}-${userId}@example.test`, passwordHash: 'x', fullName: role } as any);
    await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId, role, status: 'active' } as any);
  });
  return buildTenantContext({ actor: { userId, email: `${role}@example.test`, isStaff: false }, tenantId, requestId: `req-${role}` });
}

test('a viewer is denied a write, with 403 not 404', async () => {
  const harness = await createTestDb();
  try {
    const { tenantId } = await seedTenant(harness, 'alpha');
    const viewer = await member(harness, tenantId, 'viewer');

    assert.doesNotThrow(() => viewer.require('products:read'));
    let denied: unknown;
    try { viewer.require('products:write'); } catch (error) { denied = error; }
    assert.ok(denied, 'a viewer must not write');
    const response = problemResponse(denied, { requestId: 'req-viewer' });
    assert.equal(response.status, 403, 'a member of the tenant learns nothing by being refused — 403, not 404');
    assert.match(((await response.json()) as { detail: string }).detail, /products:write/);

    const editor = await member(harness, tenantId, 'editor');
    assert.doesNotThrow(() => editor.require('products:write'));
    assert.throws(() => editor.require('team:manage'), /missing permission: team:manage/);
  } finally { await harness.close(); }
});

test('a user from another store is told the store does not exist (404), not that they are refused', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const b = await seedTenant(harness, 'bravo');
    await assert.rejects(
      () => buildTenantContext({ actor: { userId: b.userId, email: b.email, isStaff: false }, tenantId: a.tenantId, requestId: 'r' }),
      (error: any) => error.code === 'not_found',
    );
  } finally { await harness.close(); }
});

test('roles only ever widen: viewer ⊂ editor ⊂ admin ⊂ owner, and read-only roles hold no write', () => {
  const set = (role: MemberRole) => new Set(ROLE_PERMISSIONS[role]);
  const subset = (a: MemberRole, b: MemberRole) => [...set(a)].every((p) => set(b).has(p));
  assert.ok(subset('viewer', 'editor') && subset('editor', 'admin') && subset('admin', 'owner'));
  assert.ok(subset('viewer', 'analyst') && subset('analyst', 'admin'));
  assert.equal(set('owner').size, PERMISSIONS.length);
  for (const role of ['viewer', 'analyst'] as const) {
    const writes = [...set(role)].filter((p) => !p.endsWith(':read') && p !== 'analytics:export');
    assert.deepEqual(writes, [], `${role} must hold no write permission`);
  }
});
