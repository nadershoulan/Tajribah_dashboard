/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { products, subscriptions } from '@/db/schema';
import { UNLIMITED } from '@/lib/plans';
import { uuidv7 } from '@/lib/ids';
import { planByCode } from '@/lib/plans';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { assertFeature, assertWithinQuota, currentPeriodStart, entitlementsOf } from '@/server/core/billing/entitlements';
import { problemResponse } from '@/server/core/errors/problem';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';

async function starterStore(harness: TestDb) {
  const seeded = await seedTenant(harness, 'alpha');
  const ctx = await buildTenantContext({
    actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'req-quota',
  });
  return ctx;
}

async function plantProducts(harness: TestDb, tenantId: string, count: number) {
  await harness.asAdmin(() => harness.db.insert(products).values(
    Array.from({ length: count }, (_, i) => ({ tenantId, name: `p${i}` })) as any,
  ));
}

test('a subscribed tenant gets its plan, found through the plans table', async () => {
  const harness = await createTestDb();
  try {
    const ctx = await starterStore(harness);
    const planId = await seededPlanId(harness, 'enterprise');
    const now = new Date();
    await harness.asAdmin(async () => {
      await harness.db.insert(subscriptions).values({
        id: uuidv7(), tenantId: ctx.tenantId, planId, status: 'active',
        currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
      } as any);
    });
    const entitlements = await entitlementsOf(ctx);
    assert.equal(entitlements.plan.code, 'enterprise', 'plan ids are uuids: the code has to be read from the row');
    assert.equal(entitlements.limit('products'), UNLIMITED);
    await plantProducts(harness, ctx.tenantId, planByCode('starter').limits.products + 1);
    await assert.doesNotReject(() => assertWithinQuota(ctx, 'products'));
  } finally { await harness.close(); }
});

test('exceeding a seeded product quota is refused with the right error', async () => {
  const harness = await createTestDb();
  try {
    const ctx = await starterStore(harness);
    const limit = planByCode('starter').limits.products;
    assert.equal((await entitlementsOf(ctx)).plan.code, 'starter', 'no subscription row means the Starter plan');

    await plantProducts(harness, ctx.tenantId, limit - 1);
    await assert.doesNotReject(() => assertWithinQuota(ctx, 'products'), 'one below the limit, one more fits');

    await plantProducts(harness, ctx.tenantId, 1);
    let refused: unknown;
    try { await assertWithinQuota(ctx, 'products'); } catch (error) { refused = error; }
    assert.ok(refused, `product ${limit + 1} must be refused`);
    const response = problemResponse(refused);
    assert.equal(response.status, 409);
    const body = await response.json() as { code: string; detail: string };
    assert.equal(body.code, 'quota_exceeded');
    assert.match(body.detail, new RegExp(`products \\(${limit}\\)`), 'the message names the metric and the number');
  } finally { await harness.close(); }
});

test('soft-deleted products do not count against the quota', async () => {
  const harness = await createTestDb();
  try {
    const ctx = await starterStore(harness);
    const limit = planByCode('starter').limits.products;
    await harness.asAdmin(() => harness.db.insert(products).values(
      Array.from({ length: limit }, (_, i) => ({ tenantId: ctx.tenantId, name: `d${i}`, deletedAt: new Date() })) as any,
    ));
    await assert.doesNotReject(() => assertWithinQuota(ctx, 'products'));
  } finally { await harness.close(); }
});

test("another store's products do not use up this store's quota", async () => {
  const harness = await createTestDb();
  try {
    const ctx = await starterStore(harness);
    const other = await seedTenant(harness, 'bravo');
    await plantProducts(harness, other.tenantId, planByCode('starter').limits.products + 5);
    await assert.doesNotReject(() => assertWithinQuota(ctx, 'products'));
  } finally { await harness.close(); }
});

test('a feature outside the plan is refused with 402', async () => {
  const harness = await createTestDb();
  try {
    const ctx = await starterStore(harness);
    const entitlements = await entitlementsOf(ctx);
    let refused: unknown;
    try { assertFeature(entitlements, 'virtual_tryon'); } catch (error) { refused = error; }
    assert.equal(problemResponse(refused).status, 402);
  } finally { await harness.close(); }
});

test('the billing period is the calendar month in Riyadh', () => {
  // 23:30 UTC on 31 Jan is already 1 Feb in Riyadh (UTC+3).
  assert.equal(currentPeriodStart(new Date('2026-01-31T23:30:00Z')).toISOString(), '2026-01-31T21:00:00.000Z');
  assert.equal(currentPeriodStart(new Date('2026-01-31T20:00:00Z')).toISOString(), '2025-12-31T21:00:00.000Z');
});
