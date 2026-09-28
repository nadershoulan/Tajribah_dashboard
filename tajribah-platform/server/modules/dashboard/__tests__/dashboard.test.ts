/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyTenantStats, products } from '@/db/schema';
import { riyadhDay } from '@/lib/format';
import { planByCode } from '@/lib/plans';
import { setLogLevel } from '@/server/core/observability/log';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, enablePlanFeature, seedTenant, type TestDb } from '@/server/testing/harness';
import { connectStore } from '@/server/modules/connections/service';
import { dashboardSummary } from '@/server/modules/dashboard/service';
import { updateSettings } from '@/server/modules/settings/service';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
const DAY = 86_400_000;
const NOW = new Date('2026-09-25T09:00:00Z');

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  await enablePlanFeature(harness, 'starter', 'salla'); // T35: Salla is Growth and up; this test keeps Starter's limits
  return { ...seeded, ctx: await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` }) };
}
const stat = (tenantId: string, daysAgo: number, views: number, arSessions = 0, purchases = 0) =>
  ({ tenantId, day: riyadhDay(NOW.getTime() - daysAgo * DAY), views, arSessions, purchases, revenueMinor: purchases * 1000 });

test('a new store: honest zeros, a full 30-day series, the plan\'s limits, onboarding from facts', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const s = await dashboardSummary(ctx, NOW);
    assert.equal(s.series.length, 30);
    assert.equal(s.series.at(-1)!.day, riyadhDay(NOW));
    assert.ok(s.series.every((p) => p.views === 0 && p.arSessions === 0));
    assert.deepEqual([s.last30.views, s.last30.upliftPct, s.last30.returnDeltaPct], [0, null, null], 'no invented uplift');
    assert.deepEqual(s.counts, { products: 0, arEnabled: 0, models: 0, modelsReady: 0, teamMembers: 1 });
    assert.equal(s.usage.products.limit, planByCode('starter').limits.products);
    assert.deepEqual(s.onboarding.steps.map((st) => [st.key, st.done]),
      [['account', true], ['store', false], ['connect', false], ['catalogue', false], ['first_model', false], ['embed', false]]);
    assert.equal(s.connection, null);
    assert.equal(s.tenant.role, 'owner');
  } finally { await harness.close(); }
});

test('the numbers are this store\'s last 30 Riyadh days, and the activity is what it did', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const b = await store(harness, 'beta');
    await harness.asAdmin(() => harness.db.insert(dailyTenantStats).values([
      stat(a.tenantId, 0, 100, 10, 2), stat(a.tenantId, 29, 50, 5, 1),
      stat(a.tenantId, 30, 9999, 999, 99), // outside the window
      stat(b.tenantId, 0, 7777, 777, 77), // another store
    ] as any));
    await harness.asAdmin(() => harness.db.insert(products).values([
      { tenantId: a.tenantId, name: 'On', arEnabled: true, dimensions: { widthMm: 1, heightMm: 1 } },
      { tenantId: a.tenantId, name: 'Off' },
      { tenantId: a.tenantId, name: 'Gone', status: 'archived' },
    ] as any));
    await connectStore(a.ctx, { provider: 'salla', externalStoreId: 's-a', storeName: 'Alpha on Salla', tokens: { accessToken: 't' } });

    const s = await dashboardSummary(a.ctx, NOW);
    assert.deepEqual([s.last30.views, s.last30.arSessions, s.last30.purchases, s.last30.revenueMinor], [150, 15, 3, 3000]);
    assert.equal(s.series.at(-1)!.views, 100);
    assert.equal(s.series[0].views, 50);
    assert.deepEqual([s.counts.products, s.counts.arEnabled], [2, 1], 'archived products do not count');
    assert.equal(s.connection?.storeName, 'Alpha on Salla');
    assert.equal(s.onboarding.steps.find((st) => st.key === 'connect')!.done, true);
    assert.equal(s.onboarding.steps.find((st) => st.key === 'catalogue')!.done, true, 'a sized active product');
    assert.deepEqual(s.activity.map((i) => [i.kind, i.title.en]), [['sync', 'Store connected']]);
    assert.ok(!JSON.stringify(s).includes('7777'), "another store's numbers never appear");
  } finally { await harness.close(); }
});

test('activity skips the noise and keeps what a merchant wants to see', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    await updateSettings(ctx, { city: 'الرياض' });
    const s = await dashboardSummary(ctx, NOW);
    assert.deepEqual(s.activity, [], 'a settings save is not home-screen news');
  } finally { await harness.close(); }
});
