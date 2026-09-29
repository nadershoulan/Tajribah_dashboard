/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P8 — API keys: made on Enterprise, shown once, stored as a hash; scopes within what keys may
 * hold and what their maker holds; a key acts as its maker narrowed to its scopes — and stops when
 * it is revoked or expires, when its maker leaves, when the store leaves the plan; a read-only
 * store's key cannot write; what a key does is audited as the key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { apiKeys, auditLogs, planFeatures, tenantMemberships, tenants } from '@/db/schema';
import { API_KEY_PREFIX, MAX_LIVE_KEYS } from '@/lib/api-keys';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, enablePlanFeature, seedTenant, type TestDb } from '@/server/testing/harness';
import { apiKeyContext, apiKeyContextFor } from '@/server/modules/api-keys/auth';
import { createApiKey, listApiKeys, revokeApiKey } from '@/server/modules/api-keys/service';
import { createProduct } from '@/server/modules/products/service';

setLogLevel('error');
const CONFIG = { authSecret: 's'.repeat(40) };
const unauth = (e: any) => e.code === 'unauthenticated' && e.status === 401 && e.message === 'the API key is not valid';

async function store(harness: TestDb, name: string, publicApi = true) {
  const seeded = await seedTenant(harness, name);
  if (publicApi) await enablePlanFeature(harness, 'starter', 'public_api');
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}
const READ_WRITE = { name: 'Warehouse sync', scopes: ['products:read', 'products:write'], expiresInDays: null };

test('only on a plan with the Public API; made once, shown once, kept as a hash', async () => {
  const harness = await createTestDb();
  try {
    const off = await store(harness, 'alpha', false);
    await assert.rejects(() => createApiKey(off.ctx, READ_WRITE, CONFIG), (e: any) => e.code === 'plan_required');

    await enablePlanFeature(harness, 'starter', 'public_api');
    const { key, apiKey } = await createApiKey(off.ctx, READ_WRITE, CONFIG);
    assert.ok(key.startsWith(API_KEY_PREFIX) && key.length > 40);
    assert.equal(apiKey.prefix, key.slice(0, 12));
    assert.deepEqual([apiKey.state, apiKey.scopes, apiKey.expiresAt], ['live', ['products:read', 'products:write'], null]);
    const [row] = await harness.asAdmin(() => harness.db.select().from(apiKeys).where(eq(apiKeys.id, apiKey.id)));
    assert.ok(!JSON.stringify(row).includes(key.slice(12)), 'the secret part is not stored');
    const listed = await listApiKeys(off.ctx);
    assert.equal(listed.length, 1);
    assert.ok(!JSON.stringify(listed).includes(key.slice(12)), 'nor ever listed');
    assert.ok(listed[0]!.createdBy, 'the maker is named');
    const [audit] = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(and(eq(auditLogs.resourceType, 'api_key'), eq(auditLogs.action, 'create'))));
    assert.ok(audit && !JSON.stringify(audit).includes(key.slice(12)), 'the trail records the key, not its secret');
  } finally { await harness.close(); }
});

test('a key holds only key scopes, only what its maker may do, and has a name; a store keeps at most 20 live', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const bad = (input: any, field: string) => assert.rejects(() => createApiKey(a.ctx, { ...READ_WRITE, ...input }, CONFIG),
      (e: any) => e.code === 'validation_failed' && field in e.errors);
    await bad({ name: '  ' }, 'name');
    await bad({ scopes: [] }, 'scopes');
    await bad({ scopes: ['billing:write'] }, 'scopes');
    await bad({ scopes: ['api_keys:manage'] }, 'scopes');
    await bad({ expiresInDays: 0 }, 'expiresInDays');
    const limited = { ...a.ctx, permissions: new Set([...a.ctx.permissions].filter((p) => p !== 'models:publish')) } as any;
    await assert.rejects(() => createApiKey(limited, { ...READ_WRITE, scopes: ['models:publish'] }, CONFIG),
      (e: any) => e.code === 'validation_failed' && /more than you can/.test(e.errors.scopes[0]));

    const made: Awaited<ReturnType<typeof createApiKey>>[] = [];
    for (let i = 0; i < MAX_LIVE_KEYS; i++) made.push(await createApiKey(a.ctx, { ...READ_WRITE, name: `k${i}` }, CONFIG));
    await assert.rejects(() => createApiKey(a.ctx, READ_WRITE, CONFIG), (e: any) => e.code === 'conflict');
    await revokeApiKey(a.ctx, made[0]!.apiKey.id);
    await createApiKey(a.ctx, READ_WRITE, CONFIG);
    await assert.rejects(() => revokeApiKey(a.ctx, made[0]!.apiKey.id), (e: any) => e.code === 'conflict' && /already revoked/.test(e.message));
  } finally { await harness.close(); }
});

test('a key acts as its maker narrowed to its scopes; what it does is audited as the key', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const { key, apiKey } = await createApiKey(a.ctx, READ_WRITE, CONFIG);
    const ctx = await apiKeyContext(key, CONFIG, 'req-key');
    assert.equal(ctx.tenantId, a.tenantId);
    assert.equal(ctx.actorType, 'api_key');
    ctx.require('products:write');
    assert.throws(() => ctx.require('team:read'), (e: any) => e.code === 'forbidden' && /team:read scope/.test(e.message), 'the maker may; the key may not');
    assert.equal(ctx.can('models:read'), false);
    assert.equal(ctx.can('products:read'), true);

    const product = await createProduct(ctx, { name: 'Oyster 41', status: 'draft' });
    const [audit] = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(and(eq(auditLogs.resourceType, 'product'), eq(auditLogs.resourceId, product.id))));
    assert.equal(audit!.actorType, 'api_key');
    assert.equal(audit!.actorUserId, a.ctx.actor.userId, 'made by this person’s key');

    const used = (await listApiKeys(a.ctx)).find((k) => k.id === apiKey.id)!;
    assert.ok(used.lastUsedAt, 'last use recorded');
    const request = new Request('https://app.example.test/api/v1/products', { headers: { authorization: `Bearer ${key}` } });
    assert.equal((await apiKeyContextFor(request, CONFIG)).tenantId, a.tenantId);
    await assert.rejects(() => apiKeyContextFor(new Request('https://app.example.test/api/v1/products'), CONFIG), (e: any) => e.code === 'unauthenticated');
  } finally { await harness.close(); }
});

test('the same 401 for a wrong, revoked, expired or orphaned key; 402 once the store leaves the plan; a read-only store\'s key cannot write', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    await assert.rejects(() => apiKeyContext(`${API_KEY_PREFIX}nope`, CONFIG, 'r'), unauth);
    await assert.rejects(() => apiKeyContext('sk_live_something', CONFIG, 'r'), unauth);

    const revoked = await createApiKey(a.ctx, READ_WRITE, CONFIG);
    await revokeApiKey(a.ctx, revoked.apiKey.id);
    await assert.rejects(() => apiKeyContext(revoked.key, CONFIG, 'r'), unauth);

    const expiring = await createApiKey(a.ctx, { ...READ_WRITE, expiresInDays: 30 }, CONFIG);
    await apiKeyContext(expiring.key, CONFIG, 'r');
    await assert.rejects(() => apiKeyContext(expiring.key, CONFIG, 'r', new Date(Date.now() + 31 * 86_400_000)), unauth);
    assert.equal((await listApiKeys(a.ctx, new Date(Date.now() + 31 * 86_400_000))).find((k) => k.id === expiring.apiKey.id)!.state, 'expired');

    // The maker is demoted: the key loses what they lost. Then they leave: the key stops.
    const kept = await createApiKey(a.ctx, READ_WRITE, CONFIG);
    await harness.asAdmin(() => harness.db.update(tenantMemberships).set({ role: 'viewer' } as any).where(eq(tenantMemberships.userId, a.ctx.actor.userId)));
    const demoted = await apiKeyContext(kept.key, CONFIG, 'r');
    assert.equal(demoted.can('products:write'), false);
    assert.equal(demoted.permissions.has('products:write'), false, 'the permission set itself, which some code reads directly');
    assert.throws(() => demoted.require('products:write'), (e: any) => e.code === 'forbidden');
    await harness.asAdmin(() => harness.db.update(tenantMemberships).set({ role: 'owner' } as any).where(eq(tenantMemberships.userId, a.ctx.actor.userId)));

    // Read-only store: reads yes, writes no.
    await harness.asAdmin(() => harness.db.update(tenants).set({ trialEndsAt: new Date(Date.now() - 86_400_000) } as any).where(eq(tenants.id, a.tenantId)));
    const readOnly = await apiKeyContext(kept.key, CONFIG, 'r');
    readOnly.require('products:read');
    assert.throws(() => readOnly.require('products:write'), (e: any) => e.code === 'store_read_only');
    // …and its people can still see and revoke keys (a leaked key cannot wait for a plan), not make one.
    const lapsed = await buildTenantContext({ actor: a.ctx.actor, tenantId: a.tenantId, requestId: 'r-lapsed' });
    assert.ok((await listApiKeys(lapsed)).length >= 3);
    await assert.rejects(() => createApiKey(lapsed, READ_WRITE, CONFIG), (e: any) => e.code === 'store_read_only');
    await revokeApiKey(lapsed, expiring.apiKey.id);
    await harness.asAdmin(() => harness.db.update(tenants).set({ trialEndsAt: null } as any).where(eq(tenants.id, a.tenantId)));

    await harness.asAdmin(() => harness.db.update(tenantMemberships).set({ status: 'suspended' } as any).where(eq(tenantMemberships.userId, a.ctx.actor.userId)));
    await assert.rejects(() => apiKeyContext(kept.key, CONFIG, 'r'), unauth);
    await harness.asAdmin(() => harness.db.update(tenantMemberships).set({ status: 'active' } as any).where(eq(tenantMemberships.userId, a.ctx.actor.userId)));

    await harness.asAdmin(() => harness.db.delete(planFeatures).where(eq(planFeatures.featureKey, 'public_api')));
    await assert.rejects(() => apiKeyContext(kept.key, CONFIG, 'r'), (e: any) => e.code === 'plan_required');
  } finally { await harness.close(); }
});
