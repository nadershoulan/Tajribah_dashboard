/**
 * P2.1 — the plan catalogue is rows, and the rows are what every quota reads.
 *
 *  1. After all migrations the database holds exactly lib/plans.ts: the same plans, prices,
 *     limits and features. Changing one without a migration for the other fails here.
 *  2. A limit or feature changed in the database applies to the next request — no deploy.
 *  3. A catalogue missing a row refuses (limit 0, feature off); it never gives the plan away.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { LIMIT_KEY, planFeatures, planLimits, plans, products, subscriptions } from '@/db/schema';
import { PLANS } from '@/lib/plans';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { assertFeature, assertWithinQuota, entitlementsOf } from '@/server/core/billing/entitlements';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';

setLogLevel('error');

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  return buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
}

test('the migrated catalogue is exactly lib/plans.ts — plans, prices, limits and features', async () => {
  const harness = await createTestDb();
  try {
    const rows = await harness.asAdmin(() => harness.db.select().from(plans));
    assert.deepEqual(rows.map((r) => r.code).sort(), PLANS.map((p) => p.code).sort(), 'the same plans, no more, no fewer');
    const limits = await harness.asAdmin(() => harness.db.select().from(planLimits));
    const features = await harness.asAdmin(() => harness.db.select().from(planFeatures));

    for (const plan of PLANS) {
      const row = rows.find((r) => r.code === plan.code)!;
      assert.deepEqual(
        [row.name, row.nameAr, row.priceMonthlyMinor, row.priceAnnualMinor, row.currency],
        [plan.name.en, plan.name.ar, plan.priceMonthlyMinor, plan.priceAnnualMinor, 'SAR'],
        `${plan.code}: names and prices`,
      );
      const own = new Map(limits.filter((l) => l.planId === row.id).map((l) => [l.key, l.value]));
      assert.deepEqual([...own.keys()].sort(), [...LIMIT_KEY].sort(), `${plan.code}: a row for every limit`);
      for (const key of LIMIT_KEY) assert.equal(own.get(key), plan.limits[key], `${plan.code}.${key}`);
      const on = features.filter((f) => f.planId === row.id && f.enabled).map((f) => f.featureKey).sort();
      assert.deepEqual(on, [...plan.features].sort(), `${plan.code}: features`);
    }
    assert.equal(rows.find((r) => r.code === 'enterprise')!.priceMonthlyMinor, null, 'no list price is null, not a made-up 0');
    assert.deepEqual(rows.sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.code), PLANS.map((p) => p.code), 'pricing order');
  } finally { await harness.close(); }
});

test('a limit or feature changed in the database applies on the next request, without a deploy', async () => {
  const harness = await createTestDb();
  try {
    const ctx = await store(harness, 'alpha');
    const starter = await seededPlanId(harness, 'starter');
    assert.equal((await entitlementsOf(ctx)).limit('products'), 20, 'no subscription: the Starter trial, from its rows');

    // Support lowers Starter's product limit to 2 (the admin console will do this in Track A).
    await harness.asAdmin(() => harness.db.update(planLimits).set({ value: 2 })
      .where(and(eq(planLimits.planId, starter), eq(planLimits.key, 'products'))));
    await harness.asAdmin(() => harness.db.insert(products).values([
      { tenantId: ctx.tenantId, name: 'A' }, { tenantId: ctx.tenantId, name: 'B' },
    ] as never));
    await assert.rejects(() => assertWithinQuota(ctx, 'products'), (e: { code?: string }) => e.code === 'quota_exceeded');

    const entitlements = await entitlementsOf(ctx);
    assert.equal(entitlements.has('qr_codes'), true);
    await harness.asAdmin(() => harness.db.update(planFeatures).set({ enabled: false })
      .where(and(eq(planFeatures.planId, starter), eq(planFeatures.featureKey, 'qr_codes'))));
    const after = await entitlementsOf(ctx);
    assert.equal(after.has('qr_codes'), false, 'a disabled feature row is off');
    assert.throws(() => assertFeature(after, 'qr_codes'), (e: { code?: string }) => e.code === 'plan_required');
    assert.equal(after.plan.features.includes('qr_codes'), false, 'the plan object callers read agrees');
  } finally { await harness.close(); }
});

test('a subscribed store gets its own plan’s rows; a missing row refuses rather than gives away', async () => {
  const harness = await createTestDb();
  try {
    const ctx = await store(harness, 'alpha');
    const other = await store(harness, 'bravo');
    const growth = await seededPlanId(harness, 'growth');
    const now = new Date();
    await harness.asAdmin(() => harness.db.insert(subscriptions).values({
      tenantId: ctx.tenantId, planId: growth, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 864e5),
    } as never));
    const mine = await entitlementsOf(ctx);
    assert.deepEqual([mine.plan.code, mine.limit('products'), mine.has('salla')], ['growth', 200, true]);
    assert.deepEqual([(await entitlementsOf(other)).limit('products'), (await entitlementsOf(other)).has('salla')], [20, false],
      "another store's subscription does not leak into this one's entitlements");

    await harness.asAdmin(() => harness.db.delete(planLimits).where(and(eq(planLimits.planId, growth), eq(planLimits.key, 'team_members'))));
    const missing = await entitlementsOf(ctx);
    assert.equal(missing.limit('team_members'), 0, 'no row → 0, never unlimited');
    assert.equal(missing.plan.limits.team_members, 0);
  } finally { await harness.close(); }
});
