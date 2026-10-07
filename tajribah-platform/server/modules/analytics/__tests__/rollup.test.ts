/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P4.3 — the roll-up: one store's one Riyadh day recomputed whole from its raw events into the four
 * tables the screens read; the same numbers however often it runs; each figure as the read side
 * means it; and the whole path — the widget's SDK → the collector → the queued job → the screen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, sql } from 'drizzle-orm';
import { analyticsEvents, conversionDaily, dailyProductStats, dailyTenantStats, deviceBreakdownDaily, jobs, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { withTenantSql } from '@/server/core/tenancy/rls';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { collect, resetCollector } from '@/server/modules/analytics/ingest';
import { analyticsView } from '@/server/modules/analytics/metrics';
import { RECOMPUTE_DAYS, handleRollupJob, rollupDay } from '@/server/modules/analytics/rollup';
import { currentUsage } from '@/server/core/billing/entitlements';
import { createTracker } from '@/widget/src/track';
import type { TrackInput } from '@/widget/src/events';

setLogLevel('error');
const NOW = new Date('2026-10-01T09:00:00Z'); // 12:00 in Riyadh on the 1st
const DAY = '2026-10-01';

type Seed = { type: string; session: string; product?: string | null; at?: string; device?: string; ar?: number; value?: number; currency?: string | null; duration?: number };
async function events(harness: TestDb, tenantId: string, list: Seed[]) {
  await harness.asAdmin(() => harness.db.insert(analyticsEvents).values(list.map((e) => ({
    id: uuidv7(), tenantId, eventType: e.type, productId: e.product ?? null, sessionId: e.session,
    occurredAt: new Date(e.at ?? '2026-10-01T09:00:00Z'), deviceType: e.device ?? 'mobile', arSupported: e.ar ?? 0,
    valueMinor: e.value ?? null, currency: e.currency ?? null, durationMs: e.duration ?? null,
  })) as any));
}

async function shop(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name, { plan: 'growth' });
  const [p1, p2] = [uuidv7(), uuidv7()];
  await harness.asAdmin(() => harness.db.insert(products).values([
    { id: p1, tenantId: seeded.tenantId, name: 'Oud 41', externalId: 'sku-41' },
    { id: p2, tenantId: seeded.tenantId, name: 'Pearl band', externalId: 'sku-7' },
  ] as any));
  return { ...seeded, p1, p2 };
}

const read = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);
const strip = (row: Record<string, unknown>) => { const { tenantId: _t, day: _d, ...rest } = row; void _t; void _d; return rest; };

test('a day’s events become the four tables — each figure as the screens mean it', async () => {
  const harness = await createTestDb();
  try {
    const a = await shop(harness, 'oud-shop');
    const b = await shop(harness, 'pearl-shop');
    await events(harness, a.tenantId, [
      // s1: saw P1 twice, opened AR on it three times, bought it (riyals).
      { type: 'product_view', session: 's1', product: a.p1, ar: 1 }, { type: 'product_view', session: 's1', product: a.p1, ar: 1 },
      { type: 'ar_open', session: 's1', product: a.p1, ar: 1, duration: 4000 }, { type: 'ar_open', session: 's1', product: a.p1, ar: 1, duration: 2000 }, { type: 'ar_place', session: 's1', product: a.p1 },
      { type: 'add_to_cart', session: 's1', product: a.p1 },
      { type: 'purchase', session: 's1', product: a.p1, value: 100_000, currency: 'SAR' },
      // s2: saw P1 and P2, tried P2 on, then reported a whole order (no product).
      { type: 'product_view', session: 's2', product: a.p1, device: 'desktop' }, { type: 'product_view', session: 's2', product: a.p2, device: 'desktop' },
      { type: 'tryon_start', session: 's2', product: a.p2, device: 'desktop' }, { type: 'tryon_capture', session: 's2', product: a.p2, device: 'desktop' },
      { type: 'purchase', session: 's2', value: 50_050, device: 'desktop' },
      // s3: saw P1, bought nothing.
      { type: 'product_view', session: 's3', product: a.p1, device: 'tablet' },
      // s4: saw P2, bought P1 only (reported with its product) — not a purchase of P2. In dollars: counted, adds no riyals.
      { type: 'product_view', session: 's4', product: a.p2 }, { type: 'purchase', session: 's4', product: a.p1, value: 9_999, currency: 'USD' },
      // s5: a page whose product reference is not this store's, and an AR open on it.
      { type: 'product_view', session: 's5', device: 'unknown' }, { type: 'ar_open', session: 's5', device: 'unknown' }, { type: 'ar_open', session: 's5', device: 'unknown' },
      // The edges of the Riyadh day: 23:59:59 on the 1st is in; midnight and the day before are not.
      { type: 'product_view', session: 's6', product: a.p1, at: '2026-10-01T20:59:59Z' },
      { type: 'product_view', session: 's7', product: a.p1, at: '2026-10-01T21:00:00Z' },
      { type: 'product_view', session: 's8', product: a.p1, at: '2026-09-30T20:59:59Z' },
      { type: 'product_view', session: 's9', product: a.p1, at: '2026-09-30T21:00:00Z' }, // 00:00 on the 1st in Riyadh: in
      { type: 'product_view', session: 's9', product: a.p1, at: '2026-09-30T22:00:00Z' }, // 01:00 on the 1st in Riyadh (still the 30th in UTC): in
      // s10: saw P2 without opening anything, and bought P2 itself.
      { type: 'product_view', session: 's10', product: a.p2 }, { type: 'purchase', session: 's10', product: a.p2 },
    ]);
    await events(harness, b.tenantId, [{ type: 'product_view', session: 's1', product: b.p1 }, { type: 'purchase', session: 's1', value: 777 }]);

    assert.deepEqual(await rollupDay(a.tenantId, DAY, NOW), { day: DAY, events: 23 });

    const tenant = await read(harness, () => harness.db.select().from(dailyTenantStats));
    assert.deepEqual(tenant.map((r) => [r.tenantId, String(r.day)]), [[a.tenantId, DAY]], 'this store, this day — nothing for the other store or the other days');
    assert.deepEqual(strip(tenant[0] as any), {
      views: 11, // 2 + 2 + 1 + 1 + 1 (no product) + s6 and s9's two inside the day + s10
      arSessions: 2, // s1 on P1 (three taps, one visit) and s5 on no product
      tryonSessions: 1,
      addToCart: 1,
      purchases: 4,
      revenueMinor: 150_050, // riyals and no-currency; the dollars are not converted; s10 reported no value
      uniqueSessions: 8, // s1–s5, s6, s9, s10
    });

    const byProduct = await read(harness, () => harness.db.select().from(dailyProductStats));
    assert.deepEqual(Object.fromEntries(byProduct.map((r) => [r.productId, strip({ ...r, productId: undefined } as any)])), {
      [a.p1]: { productId: undefined, views: 7, arSessions: 1, tryonSessions: 0, addToCart: 1, purchases: 2, revenueMinor: 100_000, avgArDurationMs: 3000 },
      [a.p2]: { productId: undefined, views: 3, arSessions: 0, tryonSessions: 1, addToCart: 0, purchases: 1, revenueMinor: 0, avgArDurationMs: 0 },
    }, 'the product-less view and AR open are in the store’s totals and in no product’s row');

    const conversion = await read(harness, () => harness.db.select().from(conversionDaily));
    assert.deepEqual(Object.fromEntries(conversion.map((r) => [r.productId, [r.sessionsWithAr, r.purchasesWithAr, r.sessionsWithoutAr, r.purchasesWithoutAr]])), {
      // P1: s1 with AR, bought it. Without: s2 (a whole order → bought), s3, s6, s9 (no). s4 bought P1 without seeing its page: not a visit to it.
      [a.p1]: [1, 1, 4, 1],
      // P2: s2 tried it on and its order counts. Without: s4, whose purchase named another product, and s10, who bought P2 itself.
      [a.p2]: [1, 1, 2, 1],
    });

    const devices = await read(harness, () => harness.db.select().from(deviceBreakdownDaily));
    assert.deepEqual(Object.fromEntries(devices.map((r) => [r.deviceType, [r.sessions, r.arSupported]])), {
      mobile: [5, 1], desktop: [1, 0], tablet: [1, 0], unknown: [1, 0],
    }, 's1, s4, s6, s9, s10 on mobile — one of them on a device that supports AR');
  } finally { await harness.close(); }
});

test('the same numbers however often it runs; more events, new numbers; never another store’s rows; an expired day is left alone', async () => {
  const harness = await createTestDb();
  try {
    const a = await shop(harness, 'oud-shop');
    const b = await shop(harness, 'pearl-shop');
    await events(harness, a.tenantId, [{ type: 'product_view', session: 's1', product: a.p1 }, { type: 'ar_open', session: 's1', product: a.p1 }, { type: 'product_view', session: 's0', product: a.p1 }]);
    await events(harness, b.tenantId, [{ type: 'product_view', session: 'x', product: b.p1 }]);
    await rollupDay(b.tenantId, DAY, NOW);
    const all = async () => read(harness, async () => JSON.stringify([
      await harness.db.select().from(dailyTenantStats).orderBy(dailyTenantStats.tenantId, dailyTenantStats.day),
      await harness.db.select().from(dailyProductStats).orderBy(dailyProductStats.tenantId, dailyProductStats.productId),
      await harness.db.select().from(conversionDaily).orderBy(conversionDaily.tenantId, conversionDaily.productId),
      await harness.db.select().from(deviceBreakdownDaily).orderBy(deviceBreakdownDaily.tenantId, deviceBreakdownDaily.deviceType),
    ]));

    await rollupDay(a.tenantId, DAY, NOW);
    const once = await all();
    await rollupDay(a.tenantId, DAY, NOW);
    await Promise.all([rollupDay(a.tenantId, DAY, NOW), rollupDay(a.tenantId, DAY, NOW)]); // two workers at once
    assert.equal(await all(), once, 'set, never added to');

    await events(harness, a.tenantId, [{ type: 'product_view', session: 's2', product: a.p1 }, { type: 'ar_open', session: 's1', product: a.p1 }]);
    await rollupDay(a.tenantId, DAY, NOW);
    const [row] = await read(harness, () => harness.db.select().from(dailyTenantStats).where(eq(dailyTenantStats.tenantId, a.tenantId)));
    assert.deepEqual([row!.views, row!.arSessions, row!.uniqueSessions], [3, 1, 3], 'the day now says what its events now say');
    const [conv] = await read(harness, () => harness.db.select().from(conversionDaily).where(eq(conversionDaily.tenantId, a.tenantId)));
    assert.deepEqual([conv!.sessionsWithAr, conv!.sessionsWithoutAr], [1, 2], 'and so do its conversion counts, after five runs');
    const [theirs] = await read(harness, () => harness.db.select().from(dailyTenantStats).where(eq(dailyTenantStats.tenantId, b.tenantId)));
    assert.equal(theirs!.views, 1, 'the other store’s day is its own');

    // The plan's meter reads this very figure (P2.2): AR sessions this month.
    const ctx = await buildTenantContext({ actor: { userId: a.userId, email: a.email, isStaff: false }, tenantId: a.tenantId, requestId: 'r' });
    assert.equal(await currentUsage(ctx, 'ar_sessions', NOW), 1);

    // A day with no events writes nothing; a day whose raw events may be gone is not recomputed.
    assert.deepEqual(await rollupDay(a.tenantId, '2026-09-29', NOW), { day: '2026-09-29', events: 0 });
    assert.equal((await read(harness, () => harness.db.select().from(dailyTenantStats).where(eq(dailyTenantStats.tenantId, a.tenantId)))).length, 1);
    const old = new Date(NOW.getTime() - (RECOMPUTE_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
    await read(harness, () => harness.db.insert(dailyTenantStats).values({ tenantId: a.tenantId, day: old, views: 4321 } as any));
    assert.deepEqual(await rollupDay(a.tenantId, old, NOW), { day: old, skipped: 'too_old' });
    const [kept] = await read(harness, () => harness.db.select().from(dailyTenantStats).where(and(eq(dailyTenantStats.tenantId, a.tenantId), eq(dailyTenantStats.day, old))));
    assert.equal(kept!.views, 4321, 'history is not overwritten with zeros once its events have expired');
    const edge = new Date(NOW.getTime() - RECOMPUTE_DAYS * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);
    assert.deepEqual(await rollupDay(a.tenantId, edge, NOW), { day: edge, events: 0 }, 'the last day inside the window is still recomputed');
    for (const bad of ['yesterday', '2026-13-45', "2026-10-01'; drop table tenants; --", '']) assert.deepEqual(await rollupDay(a.tenantId, bad, NOW), { day: bad, skipped: 'not_a_day' });

    // Row-level security holds beneath hand-written SQL: a statement that names no store sees one store's rows.
    const seen = await withTenantSql(a.tenantId, async (tx) => (await tx.execute(sql`select count(*)::int as n from analytics_events`)) as any);
    assert.equal(Number((seen.rows ?? seen)[0].n), 5, 'five of this store’s events — not the other store’s');
    await assert.rejects(withTenantSql('', async () => 1), /requires a tenant id/);
  } finally { await harness.close(); }
});

test('the whole path: the SDK’s batches → the collector → the queued job → the analytics screen', async () => {
  const harness = await createTestDb();
  resetCollector(); setRateLimiter(new MemoryRateLimiter());
  try {
    const a = await shop(harness, 'oud-shop');
    const send = async (session: string, inputs: TrackInput[], ua: string) => {
      let wire = '';
      const tracker = createTracker({ endpoint: 'x', store: 'oud-shop', sdk: '1.0.0', session, now: () => 1_790_000_000_000, beacon: () => true, onSend: (batch) => { wire = JSON.stringify(batch); } });
      for (const input of inputs) tracker.track(input);
      tracker.flush();
      const request = new Request('https://ev.tajribah.org/v1/e', { method: 'POST', body: wire, headers: { 'user-agent': ua, 'cf-connecting-ip': '203.0.113.7' } });
      assert.equal(await collect(request, { secret: 's'.repeat(40), now: NOW }), 'accepted');
    };
    const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1';
    const laptop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
    await send('visit_aaaaaaaaaaaaaaaa', [
      { type: 'product_view', productId: 'sku-41', arSupported: true }, { type: 'ar_open', productId: 'sku-41', arSupported: true },
      { type: 'add_to_cart', productId: 'sku-41' }, { type: 'purchase', valueMinor: 159_900, currency: 'SAR' },
    ], phone);
    await send('visit_bbbbbbbbbbbbbbbb', [{ type: 'product_view', productId: 'sku-41', arSupported: false }, { type: 'product_view', productId: 'sku-7', arSupported: false }, { type: 'tryon_start', productId: 'sku-7' }], laptop);

    const queued = await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.queue, 'analytics.rollup')));
    assert.equal(queued.length, 1);
    await handleRollupJob(queued[0]!);
    await assert.rejects(handleRollupJob({ ...queued[0]!, tenantId: null } as any), /no tenant/);
    await assert.rejects(handleRollupJob({ ...queued[0]!, payload: {} } as any), /names no day/);

    const ctx = await buildTenantContext({ actor: { userId: a.userId, email: a.email, isStaff: false }, tenantId: a.tenantId, requestId: 'r' });
    const view = await analyticsView(ctx, '7d', NOW);
    assert.deepEqual(
      [view.totals.views, view.totals.arSessions, view.totals.tryonSessions, view.totals.addToCart, view.totals.purchases, view.totals.revenueMinor],
      [3, 1, 1, 1, 1, 159_900]);
    assert.deepEqual(view.series.at(-1), { day: DAY, views: 3, arSessions: 1, tryonSessions: 1, purchases: 1 });
    assert.deepEqual(view.byDevice, [{ device: 'mobile', sessions: 1, arSupported: 1 }, { device: 'tablet', sessions: 0, arSupported: 0 }, { device: 'desktop', sessions: 1, arSupported: 0 }]);
    assert.deepEqual(view.topProducts.map((p) => [p.name, p.views, p.arSessions, p.tryonSessions, p.purchases]), [['Oud 41', 2, 1, 0, 0], ['Pearl band', 1, 0, 1, 0]]);
    assert.deepEqual(view.conversion.withAr, { sessions: 2, purchases: 1 }, 'the phone visit (AR on Oud 41, then an order) and the laptop’s try-on of Pearl band');
    assert.deepEqual(view.conversion.withoutAr, { sessions: 1, purchases: 0 }, 'the laptop saw Oud 41 without opening it');
    assert.equal(view.totals.upliftPct, null, 'three visits are not a sample: no number');
  } finally { await harness.close(); }
});
