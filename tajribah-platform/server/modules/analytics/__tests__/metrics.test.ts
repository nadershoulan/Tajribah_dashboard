/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P4.4 — the analytics read path: whole Riyadh days with empty days as zero, only this store's
 * rollup rows, the three device buckets, top products by views with their names, and uplift
 * shown only when both groups are big enough — including when it is negative.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversionDaily, dailyProductStats, dailyTenantStats, deviceBreakdownDaily, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { MIN_SESSIONS, analyticsView, daysOf, upliftOf } from '@/server/modules/analytics/metrics';

setLogLevel('error');
// 22:00 UTC on 27 Sep is already 28 Sep in Riyadh: "today" is the 28th.
const NOW = new Date('2026-09-27T22:00:00Z');

test('upliftOf: with minus without, as a fraction; null below the minimum on either side; negative stays negative', () => {
  const big = MIN_SESSIONS;
  assert.equal(upliftOf({ sessionsWithAr: big * 2, purchasesWithAr: 20, sessionsWithoutAr: big * 10, purchasesWithoutAr: 50 }), 0.05, '10% − 5% = 5 points');
  assert.equal(upliftOf({ sessionsWithAr: big, purchasesWithAr: 2, sessionsWithoutAr: big, purchasesWithoutAr: 5 }), -0.03, 'a worse result is shown as worse');
  assert.equal(upliftOf({ sessionsWithAr: big - 1, purchasesWithAr: 50, sessionsWithoutAr: big * 10, purchasesWithoutAr: 1 }), null, 'too few with AR');
  assert.equal(upliftOf({ sessionsWithAr: big * 10, purchasesWithAr: 50, sessionsWithoutAr: big - 1, purchasesWithoutAr: 1 }), null, 'too few without');
  assert.deepEqual([daysOf('7d', NOW)[0], daysOf('7d', NOW).at(-1), daysOf('90d', NOW).length], ['2026-09-22', '2026-09-28', 90]);
});

async function seed(harness: TestDb, tenantId: string) {
  const ids = [uuidv7(), uuidv7(), uuidv7()];
  await harness.asAdmin(async () => {
    const db = harness.db;
    await db.insert(products).values([{ id: ids[0], tenantId, name: 'Oud 41' }, { id: ids[1], tenantId, name: 'Pearl band' }, { id: ids[2], tenantId, name: 'Quiet one' }] as any);
    await db.insert(dailyTenantStats).values([
      { tenantId, day: '2026-09-28', views: 100, arSessions: 30, tryonSessions: 10, addToCart: 8, purchases: 4, revenueMinor: 40_000, uniqueSessions: 90 },
      { tenantId, day: '2026-09-25', views: 50, arSessions: 10, tryonSessions: 5, addToCart: 3, purchases: 1, revenueMinor: 9_900, uniqueSessions: 45 },
      { tenantId, day: '2026-09-21', views: 999, arSessions: 999, tryonSessions: 999, addToCart: 999, purchases: 999, revenueMinor: 999, uniqueSessions: 999 }, // outside 7d
    ] as any);
    await db.insert(dailyProductStats).values([
      { tenantId, productId: ids[0], day: '2026-09-28', views: 70, arSessions: 25, purchases: 3 },
      { tenantId, productId: ids[1], day: '2026-09-28', views: 30, arSessions: 5, purchases: 1 },
      { tenantId, productId: ids[1], day: '2026-09-25', views: 50, arSessions: 10, purchases: 1 },
      { tenantId, productId: ids[2], day: '2026-09-28', views: 0, arSessions: 0, purchases: 0 },
    ] as any);
    await db.insert(conversionDaily).values([
      { tenantId, productId: ids[0], day: '2026-09-28', sessionsWithAr: 200, purchasesWithAr: 20, sessionsWithoutAr: 1000, purchasesWithoutAr: 50 },
      { tenantId, productId: ids[1], day: '2026-09-28', sessionsWithAr: 10, purchasesWithAr: 1, sessionsWithoutAr: 40, purchasesWithoutAr: 1 },
    ] as any);
    await db.insert(deviceBreakdownDaily).values([
      { tenantId, day: '2026-09-28', deviceType: 'mobile', sessions: 80, arSupported: 70 },
      { tenantId, day: '2026-09-25', deviceType: 'mobile', sessions: 30, arSupported: 25 },
      { tenantId, day: '2026-09-28', deviceType: 'desktop', sessions: 20, arSupported: 0 },
      { tenantId, day: '2026-09-28', deviceType: 'unknown', sessions: 7, arSupported: 0 },
    ] as any);
  });
  return ids;
}

test('the view: the range’s days (empty ones zero), totals inside the range only, devices, top products with names and uplift, the funnel', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const other = await seedTenant(harness, 'bravo');
    const ids = await seed(harness, store.tenantId);
    await seed(harness, other.tenantId); // the same numbers in another store must not leak in
    const ctx = await buildTenantContext({ actor: { userId: store.userId, email: store.email, isStaff: false }, tenantId: store.tenantId, requestId: 'r' });

    const view = await analyticsView(ctx, '7d', NOW);
    assert.equal(view.series.length, 7);
    assert.deepEqual(view.series.map((p) => p.views), [0, 0, 0, 50, 0, 0, 100], 'empty days are zero, the 21st is outside');
    assert.deepEqual(
      [view.totals.views, view.totals.arSessions, view.totals.tryonSessions, view.totals.addToCart, view.totals.purchases, view.totals.revenueMinor],
      [150, 40, 15, 11, 5, 49_900],
    );
    assert.equal(view.totals.upliftPct, 0.051, 'store: 21/210 = 10.0% with, 51/1040 = 4.9% without → +5.1 points');
    assert.equal(view.totals.returnDeltaPct, null, 'returns need order sync (P4.7): no guess');
    assert.deepEqual(view.byDevice, [
      { device: 'mobile', sessions: 110, arSupported: 95 }, { device: 'tablet', sessions: 0, arSupported: 0 }, { device: 'desktop', sessions: 20, arSupported: 0 },
    ], 'unknown devices are not guessed into a bucket');
    assert.deepEqual(view.topProducts.map((p) => [p.productId, p.name, p.views, p.upliftPct]), [
      [ids[1], 'Pearl band', 80, null], // 10 sessions with AR: too few for a number
      [ids[0], 'Oud 41', 70, 0.05],
      [ids[2], 'Quiet one', 0, null],
    ]);
    assert.deepEqual(view.funnel.map((f) => f.value), [150, 40, 15, 11, 5]);

    const quarter = await analyticsView(ctx, '90d', NOW);
    assert.equal(quarter.totals.views, 150 + 999, 'the 21st is inside 90 days');
  } finally { await harness.close(); }
});
