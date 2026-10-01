/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P4.9 — the live view: the last half hour of one store's raw events, minute by minute; the visits
 * of the last five minutes; the latest events with their product; never another store's, never the
 * future's, and kept for ten seconds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsEvents, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { MemoryCache, configureCache } from '@/server/core/cache/cache';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { ACTIVE_MINUTES, LIVE_LATEST, LIVE_MINUTES, liveActivity } from '@/server/modules/analytics/live';

setLogLevel('error');
const NOW = new Date('2026-10-01T09:30:20Z');
const ago = (minutes: number, seconds = 0) => new Date(NOW.getTime() - minutes * 60_000 - seconds * 1000);

type Seed = { type: string; session: string; at: Date; product?: string | null; device?: string; country?: string | null };
async function events(harness: TestDb, tenantId: string, list: Seed[]) {
  await harness.asAdmin(() => harness.db.insert(analyticsEvents).values(list.map((e) => ({
    id: uuidv7(), tenantId, eventType: e.type, productId: e.product ?? null, sessionId: e.session, occurredAt: e.at,
    deviceType: e.device ?? 'mobile', country: e.country === undefined ? 'SA' : e.country,
  })) as any));
}

async function shop(harness: TestDb, name: string, plan: 'starter' | 'growth' = 'growth') {
  const seeded = await seedTenant(harness, name, { plan });
  const productId = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values({ id: productId, tenantId: seeded.tenantId, name: `${name} watch` } as any));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, productId, ctx };
}

test('the last half hour, minute by minute; the visits of the last five minutes; the latest events — this store’s only', async () => {
  const harness = await createTestDb();
  configureCache(new MemoryCache());
  try {
    const a = await shop(harness, 'oud');
    const b = await shop(harness, 'pearl');
    await events(harness, a.tenantId, [
      { type: 'product_view', session: 's1', at: ago(0, 5), product: a.productId },
      { type: 'tryon_start', session: 's1', at: ago(0, 2), product: a.productId },
      { type: 'product_view', session: 's2', at: ago(0, 19), product: null, device: 'desktop', country: null }, // 09:30:01: still this minute
      { type: 'product_view', session: 's3', at: ago(0, 21) }, // 09:29:59: the minute before
      { type: 'ar_open', session: 's3', at: ago(3) },
      { type: 'add_to_cart', session: 's4', at: ago(4, 59) }, // just inside five minutes
      { type: 'purchase', session: 's5', at: ago(5) }, // exactly five minutes ago: not active any more
      { type: 'product_view', session: 's6', at: ago(29, 19) }, // 09:01:01 — the first minute shown
      { type: 'product_view', session: 's7', at: ago(29, 21) }, // 09:00:59 — a second too old
      { type: 'product_view', session: 's8', at: ago(90) },
      { type: 'product_view', session: 's9', at: new Date(NOW.getTime() + 5000) }, // a clock ahead of "now": not shown
    ]);
    await events(harness, b.tenantId, [{ type: 'product_view', session: 's1', at: ago(0, 1), product: b.productId }, { type: 'purchase', session: 'x', at: ago(1) }]);

    const view = await liveActivity(a.ctx, NOW);
    assert.equal(view.asOf, NOW.toISOString());
    assert.equal(view.minutes.length, LIVE_MINUTES);
    assert.deepEqual([view.minutes[0]!.at, view.minutes.at(-1)!.at], ['2026-10-01T09:01:00.000Z', '2026-10-01T09:30:00.000Z']);
    const busy = Object.fromEntries(view.minutes.filter((m) => m.views + m.opens > 0).map((m) => [m.at.slice(11, 16), [m.views, m.opens]]));
    assert.deepEqual(busy, { '09:01': [1, 0], '09:27': [0, 1], '09:29': [1, 0], '09:30': [2, 1] }, 'views, and AR or try-on openings, in the minute each happened');
    assert.equal(view.activeVisits, 4, `s1–s4: any event in the last ${ACTIVE_MINUTES} minutes — s5 was five minutes ago`);
    assert.deepEqual(view.latest.map((e) => [e.type, e.product, e.device, e.country]), [
      ['tryon_start', 'oud watch', 'mobile', 'SA'], ['product_view', 'oud watch', 'mobile', 'SA'], ['product_view', null, 'desktop', null],
      ['product_view', null, 'mobile', 'SA'], ['ar_open', null, 'mobile', 'SA'], ['add_to_cart', null, 'mobile', 'SA'], ['purchase', null, 'mobile', 'SA'], ['product_view', null, 'mobile', 'SA'],
    ], 'newest first, with the product’s name; nothing older than the half hour, nothing from the future');
    assert.ok(!JSON.stringify(view).includes('s1') && !JSON.stringify(view).includes('session'), 'no visit is named: a visit here is a count');

    const theirs = await liveActivity(b.ctx, NOW);
    assert.deepEqual([theirs.activeVisits, theirs.latest.length, theirs.latest[0]!.product], [2, 2, 'pearl watch'], 'the other store sees its own half hour');

    // Kept for ten seconds: an answer already given is given again; a fresh cache sees the new event.
    await events(harness, a.tenantId, [{ type: 'purchase', session: 's1', at: ago(0, 1) }]);
    assert.equal((await liveActivity(a.ctx, NOW)).latest[0]!.type, 'tryon_start');
    configureCache(new MemoryCache());
    assert.equal((await liveActivity(a.ctx, NOW)).latest[0]!.type, 'purchase');

    // More events than the list holds: the newest ones.
    await events(harness, a.tenantId, Array.from({ length: 30 }, (_, i) => ({ type: 'product_view', session: `bulk${i}`, at: ago(10, i) })));
    configureCache(new MemoryCache());
    const full = await liveActivity(a.ctx, NOW);
    assert.equal(full.latest.length, LIVE_LATEST);
    assert.equal(full.minutes.find((m) => m.at.slice(11, 16) === '09:20')!.views + full.minutes.find((m) => m.at.slice(11, 16) === '09:19')!.views, 30);
  } finally { configureCache(null); await harness.close(); }
});

test('the live view is part of full analytics, for those who may read analytics; a quiet shop is thirty empty minutes', async () => {
  const harness = await createTestDb();
  configureCache(new MemoryCache());
  try {
    const small = await shop(harness, 'small', 'starter');
    await assert.rejects(liveActivity(small.ctx, NOW), (e: any) => e.code === 'plan_required');
    const quiet = await shop(harness, 'quiet');
    const view = await liveActivity(quiet.ctx, NOW);
    assert.deepEqual([view.activeVisits, view.latest.length, view.minutes.length, view.minutes.every((m) => m.views === 0 && m.opens === 0)], [0, 0, 30, true]);
    const cannot = { ...quiet.ctx, require(p: string) { if (p === 'analytics:read') throw Object.assign(new Error('forbidden'), { code: 'forbidden' }); } };
    await assert.rejects(liveActivity(cannot as any, NOW), (e: any) => e.code === 'forbidden', 'the permission is asked before anything is read');
  } finally { configureCache(null); await harness.close(); }
});
