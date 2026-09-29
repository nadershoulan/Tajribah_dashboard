/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P7 — caching. Keys always start with the store (`t:{tenantId}:{domain}:{id}`), taken from the
 * request's context; entries expire; the memory cache cannot grow without bound; a failing cache
 * never breaks a read. The analytics screen's answer is kept a minute (plan D5): a second look
 * within the minute does not read the database, another store never sees it, and the permission
 * check still happens first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { dailyTenantStats, plans, subscriptions } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { setLogLevel } from '@/server/core/observability/log';
import { errors } from '@/server/core/errors/problem';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { EdgeCache, MemoryCache, cachedFor, configureCache, tenantKey, type CacheStore } from '@/server/core/cache/cache';
import { ANALYTICS_CACHE_SECONDS, analyticsView } from '@/server/modules/analytics/metrics';

setLogLevel('error');

test('a cache key always starts with the store, and only a real store id', () => {
  const a = uuidv7();
  assert.equal(tenantKey(a, 'analytics', 'view:7d'), `t:${a}:analytics:view:7d`);
  assert.equal(tenantKey(a.toUpperCase(), 'analytics', 'x'), `t:${a}:analytics:x`, 'one spelling per store');
  for (const bad of ['', 'alpha', `${a}:x`, '*']) assert.throws(() => tenantKey(bad, 'analytics', 'x'), /uuid/, bad);
  for (const bad of ['', 'Analytics', 'a:b', '9x', 'a'.repeat(41)]) assert.throws(() => tenantKey(a, bad, 'x'), /domain/, bad);
  assert.throws(() => tenantKey(a, 'analytics', ''), /id/);
  assert.throws(() => tenantKey(a, 'analytics', 'x'.repeat(201)), /id/);
});

test('memory entries expire, and the oldest go past the cap', async () => {
  let now = 0;
  const cache = new MemoryCache(3, () => now);
  await cache.put('k', 'v', 60);
  now = 59_999;
  assert.equal(await cache.get('k'), 'v');
  now = 60_000;
  assert.equal(await cache.get('k'), null, 'gone at its time');
  for (const k of ['a', 'b', 'c', 'd']) await cache.put(k, k, 60);
  assert.equal(cache.size, 3);
  assert.equal(await cache.get('a'), null, 'the oldest dropped');
  assert.equal(await cache.get('d'), 'd');
  await cache.put('b', 'b2', 60); // rewriting makes it the newest
  await cache.put('e', 'e', 60);
  assert.equal(await cache.get('b'), 'b2');
  assert.equal(await cache.get('c'), null);
});

test('computed once per minute per store; another store gets its own; a broken cache still answers', async () => {
  let now = 0;
  configureCache(new MemoryCache(100, () => now));
  try {
    const a = { tenantId: uuidv7() };
    const b = { tenantId: uuidv7() };
    let runs = 0;
    const compute = (label: string) => async () => { runs++; return { label, n: runs }; };
    assert.deepEqual(await cachedFor(a, 'analytics', 'view', 60, compute('a')), { label: 'a', n: 1 });
    assert.deepEqual(await cachedFor(a, 'analytics', 'view', 60, compute('a')), { label: 'a', n: 1 }, 'kept');
    assert.deepEqual(await cachedFor(b, 'analytics', 'view', 60, compute('b')), { label: 'b', n: 2 }, 'the other store computes its own');
    now = 60_000;
    assert.deepEqual(await cachedFor(a, 'analytics', 'view', 60, compute('a')), { label: 'a', n: 3 }, 'after a minute, fresh');

    const broken: CacheStore = { get: async () => { throw new Error('down'); }, put: async () => { throw new Error('down'); } };
    configureCache(broken);
    assert.deepEqual(await cachedFor(a, 'analytics', 'view', 60, compute('a')), { label: 'a', n: 4 }, 'answered without the cache');
  } finally {
    configureCache(null);
  }
});

test('the Cache API adapter: one address per key, expiry sent as max-age', async () => {
  const seen: { url: string; cacheControl: string | null; body: string }[] = [];
  const stored = new Map<string, string>();
  const edge = new EdgeCache({
    async match(request) { const body = stored.get(request.url); return body === undefined ? undefined : new Response(body); },
    async put(request, response) {
      const body = await response.text();
      seen.push({ url: request.url, cacheControl: response.headers.get('cache-control'), body });
      stored.set(request.url, body);
    },
  });
  const a = uuidv7();
  const b = uuidv7();
  await edge.put(tenantKey(a, 'analytics', 'view:7d'), '{"x":1}', 60);
  assert.equal(seen[0]!.cacheControl, 'max-age=60');
  assert.equal(await edge.get(tenantKey(a, 'analytics', 'view:7d')), '{"x":1}');
  assert.equal(await edge.get(tenantKey(b, 'analytics', 'view:7d')), null, 'another store, another address');
  assert.equal(await edge.get(tenantKey(a, 'analytics', 'view:30d')), null);
  assert.ok(seen[0]!.url.startsWith('https://cache.tajribah.internal/') && !seen[0]!.url.slice(8).includes(':'), 'the key is encoded whole');
});

test('the analytics screen: a minute old at most, the store’s own, the permission checked first', async () => {
  let now = 0;
  configureCache(new MemoryCache(100, () => now));
  const harness = await createTestDb();
  try {
    const at = new Date('2026-09-27T22:00:00Z'); // the 28th in Riyadh
    const one = await seedTenant(harness, 'alpha');
    const two = await seedTenant(harness, 'bravo');
    const ctxOf = (s: typeof one) => buildTenantContext({ actor: { userId: s.userId, email: s.email, isStaff: false }, tenantId: s.tenantId, requestId: 'r' });
    const a = await ctxOf(one);
    const b = await ctxOf(two);
    const day = (tenantId: string, views: number) => harness.asAdmin(() => harness.db.insert(dailyTenantStats).values({ tenantId, day: '2026-09-28', views, arSessions: 0, tryonSessions: 0, addToCart: 0, purchases: 0, revenueMinor: 0, uniqueSessions: 0 } as any));

    await day(one.tenantId, 100);
    assert.equal((await analyticsView(a, '7d', at)).totals.views, 100);
    await day(two.tenantId, 7);
    assert.equal((await analyticsView(b, '7d', at)).totals.views, 7, 'the other store never gets the first store’s answer');

    await harness.asAdmin(() => harness.db.update(dailyTenantStats).set({ views: 150 } as any));
    assert.equal((await analyticsView(a, '7d', at)).totals.views, 100, 'within the minute: the kept answer');
    assert.equal((await analyticsView(a, '30d', at)).totals.views, 150, 'another range is its own answer');
    assert.equal((await analyticsView(a, '7d', new Date('2026-09-28T22:00:00Z'))).totals.views, 150, 'a new day is its own answer');
    now = ANALYTICS_CACHE_SECONDS * 1000;
    assert.equal((await analyticsView(a, '7d', at)).totals.views, 150, 'after the minute: fresh');

    // A store that moves to a plan with full analytics sees the full view at once, not the kept basic one.
    const three = await seedTenant(harness, 'charlie', { plan: 'starter' });
    const c = await ctxOf(three);
    assert.equal((await analyticsView(c, '7d', at)).level, 'basic');
    const [growth] = await harness.asAdmin(() => harness.db.select({ id: plans.id }).from(plans).where(eq(plans.code, 'growth')));
    await harness.asAdmin(() => harness.db.update(subscriptions).set({ planId: growth!.id } as any).where(eq(subscriptions.tenantId, three.tenantId)));
    assert.equal((await analyticsView(c, '7d', at)).level, 'full');

    // Someone who may not read analytics is refused even though an answer is kept.
    const refused = Object.assign(Object.create(Object.getPrototypeOf(a)), a, { require: () => { throw errors.forbidden(); } });
    await assert.rejects(() => analyticsView(refused, '7d', at), (e: any) => e.status === 403);
  } finally {
    configureCache(null);
    await harness.close();
  }
});
