/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P4.10 — the session explorer: one Riyadh day's visits, latest first, filtered and paged; one
 * visit's path in order; only this store's, only what is still kept, and part of full analytics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsEvents, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { PATH_MAX_EVENTS, SESSIONS_PAGE, sessionList, sessionPath } from '@/server/modules/analytics/sessions';

setLogLevel('error');
const NOW = new Date('2026-10-01T09:00:00Z'); // 12:00 on the 1st in Riyadh
const sid = (n: string) => `visit_${n}`.padEnd(43, 'x');

type Seed = { type: string; session: string; at: string; product?: string | null; device?: string; value?: number; currency?: string; props?: Record<string, string> };
async function events(harness: TestDb, tenantId: string, list: Seed[]) {
  await harness.asAdmin(() => harness.db.insert(analyticsEvents).values(list.map((e) => ({
    id: uuidv7(), tenantId, eventType: e.type, productId: e.product ?? null, sessionId: sid(e.session), occurredAt: new Date(e.at),
    deviceType: e.device ?? 'mobile', os: 'iOS', browser: 'Safari', country: 'SA', region: '01', referrerHost: 'shop.example.sa',
    valueMinor: e.value ?? null, currency: e.currency ?? null, properties: e.props ?? {},
  })) as any));
}

async function shop(harness: TestDb, name: string, plan: 'starter' | 'growth' = 'growth') {
  const seeded = await seedTenant(harness, name, { plan });
  const productId = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values({ id: productId, tenantId: seeded.tenantId, name: `${name} watch` } as any));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, productId, ctx };
}

test('one day’s visits, latest first, with what each did; filters; another store’s and another day’s left out', async () => {
  const harness = await createTestDb();
  try {
    const a = await shop(harness, 'oud');
    const b = await shop(harness, 'pearl');
    await events(harness, a.tenantId, [
      { type: 'product_view', session: 'looker', at: '2026-10-01T05:00:00Z', product: a.productId },
      { type: 'product_view', session: 'buyer', at: '2026-10-01T06:00:00Z', product: a.productId },
      { type: 'tryon_start', session: 'buyer', at: '2026-10-01T06:01:00Z', product: a.productId },
      { type: 'add_to_cart', session: 'buyer', at: '2026-10-01T06:02:00Z', product: a.productId },
      { type: 'purchase', session: 'buyer', at: '2026-10-01T06:03:00Z', value: 159_900, currency: 'SAR', props: { coupon: 'EID' } },
      { type: 'ar_open', session: 'opener', at: '2026-10-01T07:00:00Z', product: a.productId, device: 'desktop' },
      { type: 'product_view', session: 'midnight', at: '2026-09-30T21:00:00Z' }, // 00:00 on the 1st in Riyadh: this day
      // Came first, stayed longest: ordered by its latest event, so it is the most recent visit.
      { type: 'product_view', session: 'lingerer', at: '2026-10-01T04:30:00Z', product: a.productId },
      { type: 'add_to_cart', session: 'lingerer', at: '2026-10-01T08:00:00Z', product: a.productId },
      { type: 'product_view', session: 'yesterday', at: '2026-09-30T20:59:59Z' }, // 23:59:59 on the 30th
    ]);
    await events(harness, b.tenantId, [{ type: 'purchase', session: 'buyer', at: '2026-10-01T08:00:00Z' }]);

    const day = await sessionList(a.ctx, {}, NOW);
    assert.deepEqual([day.day, day.today, day.oldest, day.kept, day.more], ['2026-10-01', '2026-10-01', '2026-07-04', true, false], 'today by default; 90 days kept, today included');
    assert.deepEqual(day.sessions.map((s) => [s.id, s.events, s.products, s.opened, s.carted, s.bought, s.device]), [
      [sid('lingerer'), 2, 1, false, true, false, 'mobile'],
      [sid('opener'), 1, 1, true, false, false, 'desktop'],
      [sid('buyer'), 4, 1, true, true, true, 'mobile'],
      [sid('looker'), 1, 1, false, false, false, 'mobile'],
      [sid('midnight'), 1, 0, false, false, false, 'mobile'],
    ], 'latest first; the other store’s buyer and the visit of the 30th are not here');
    const buyer = day.sessions[2]!;
    assert.deepEqual([buyer.firstAt, buyer.lastAt, buyer.country], ['2026-10-01T06:00:00.000Z', '2026-10-01T06:03:00.000Z', 'SA']);

    assert.deepEqual((await sessionList(a.ctx, { filter: 'opened' }, NOW)).sessions.map((s) => s.id), [sid('opener'), sid('buyer')]);
    assert.deepEqual((await sessionList(a.ctx, { filter: 'bought' }, NOW)).sessions.map((s) => s.id), [sid('buyer')]);
    assert.deepEqual((await sessionList(a.ctx, { day: '2026-09-30' }, NOW)).sessions.map((s) => s.id), [sid('yesterday')]);

    // Outside what is kept, or not yet come: said, not shown as a quiet day.
    for (const d of ['2026-07-03', '2026-10-02']) {
      const out = await sessionList(a.ctx, { day: d }, NOW);
      assert.deepEqual([out.kept, out.sessions.length], [false, 0], d);
    }
    assert.equal((await sessionList(a.ctx, { day: '2026-07-04' }, NOW)).kept, true, 'the oldest kept day is still readable');
    for (const bad of ['yesterday', '2026-13-01', "2026-10-01'--"]) await assert.rejects(sessionList(a.ctx, { day: bad }, NOW), (e: any) => e.code === 'validation_failed', bad);
  } finally { await harness.close(); }
});

test('paging: fifty at a time, with whether there are more', async () => {
  const harness = await createTestDb();
  try {
    const a = await shop(harness, 'oud');
    await events(harness, a.tenantId, Array.from({ length: SESSIONS_PAGE + 3 }, (_, i) => ({ type: 'product_view', session: `v${String(i).padStart(3, '0')}`, at: new Date(Date.parse('2026-10-01T05:00:00Z') + i * 1000).toISOString() })));
    const first = await sessionList(a.ctx, {}, NOW);
    assert.deepEqual([first.sessions.length, first.more, first.sessions[0]!.id], [SESSIONS_PAGE, true, sid(`v${String(SESSIONS_PAGE + 2).padStart(3, '0')}`)]);
    const second = await sessionList(a.ctx, { offset: SESSIONS_PAGE }, NOW);
    assert.deepEqual([second.sessions.length, second.more, second.offset, second.sessions.at(-1)!.id], [3, false, SESSIONS_PAGE, sid('v000')]);
    assert.equal(new Set([...first.sessions, ...second.sessions].map((s) => s.id)).size, SESSIONS_PAGE + 3, 'no visit on both pages, none missed');
    assert.equal((await sessionList(a.ctx, { offset: -5 }, NOW)).offset, 0);
    assert.equal((await sessionList(a.ctx, { offset: 1e9 }, NOW)).offset, 950, 'a page far away is capped, not a scan of the whole day');
  } finally { await harness.close(); }
});

test('one visit’s path, in order, with what each event holds — and only this store’s visits', async () => {
  const harness = await createTestDb();
  try {
    const a = await shop(harness, 'oud');
    const b = await shop(harness, 'pearl');
    await events(harness, a.tenantId, [
      { type: 'purchase', session: 'buyer', at: '2026-10-01T06:03:00Z', value: 159_900, currency: 'SAR', props: { coupon: 'EID' } },
      { type: 'product_view', session: 'buyer', at: '2026-10-01T06:00:00Z', product: a.productId },
      { type: 'tryon_start', session: 'buyer', at: '2026-10-01T06:01:00Z', product: a.productId },
      { type: 'product_view', session: 'buyer', at: '2026-10-01T06:02:00Z' },
    ]);
    await events(harness, b.tenantId, [{ type: 'product_view', session: 'theirs', at: '2026-10-01T06:00:00Z' }]);

    const path = await sessionPath(a.ctx, sid('buyer'));
    assert.deepEqual([path.firstAt, path.lastAt, path.device, path.os, path.browser, path.country, path.region, path.page, path.truncated],
      ['2026-10-01T06:00:00.000Z', '2026-10-01T06:03:00.000Z', 'mobile', 'iOS', 'Safari', 'SA', '01', 'shop.example.sa', false]);
    assert.deepEqual(path.events.map((e) => [e.type, e.product, e.valueMinor, e.currency, e.properties]), [
      ['product_view', 'oud watch', null, null, {}], ['tryon_start', 'oud watch', null, null, {}],
      ['product_view', null, null, null, {}], ['purchase', null, 159_900, 'SAR', { coupon: 'EID' }],
    ]);

    const missing = (e: any) => e.code === 'not_found';
    await assert.rejects(sessionPath(a.ctx, sid('theirs')), missing, 'another store’s visit is not found — not forbidden');
    await assert.rejects(sessionPath(a.ctx, sid('nobody')), missing);
    for (const bad of ['short', 'has space in it xxxxxxxxxxxx', `${'x'.repeat(65)}`, "x' or '1'='1xxxxxxxxxxxx"]) await assert.rejects(sessionPath(a.ctx, bad), missing, bad);

    await events(harness, a.tenantId, Array.from({ length: PATH_MAX_EVENTS + 5 }, (_, i) => ({ type: 'product_view', session: 'long', at: new Date(Date.parse('2026-10-01T05:00:00Z') + i * 1000).toISOString() })));
    const long = await sessionPath(a.ctx, sid('long'));
    assert.deepEqual([long.events.length, long.truncated, long.events[0]!.at], [PATH_MAX_EVENTS, true, '2026-10-01T05:00:00.000Z'], 'the first events, and it says there are more');
  } finally { await harness.close(); }
});

test('the explorer is part of full analytics, for those who may read analytics', async () => {
  const harness = await createTestDb();
  try {
    const small = await shop(harness, 'small', 'starter');
    await assert.rejects(sessionList(small.ctx, {}, NOW), (e: any) => e.code === 'plan_required');
    await assert.rejects(sessionPath(small.ctx, sid('any')), (e: any) => e.code === 'plan_required');
    const growth = await shop(harness, 'growth');
    const cannot = { ...growth.ctx, require(p: string) { if (p === 'analytics:read') throw Object.assign(new Error('forbidden'), { code: 'forbidden' }); } };
    await assert.rejects(sessionList(cannot as any, {}, NOW), (e: any) => e.code === 'forbidden');
    await assert.rejects(sessionPath(cannot as any, sid('any')), (e: any) => e.code === 'forbidden');
  } finally { await harness.close(); }
});
