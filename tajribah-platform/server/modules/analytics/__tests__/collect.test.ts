/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P4.2 — the collector, fed by the widget's own SDK: what a shop's page sends is what is stored,
 * minus everything that could identify a shopper; and each defence, in its order — the body cap,
 * the store key, robots, the two rate limits, the contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { analyticsEvents, jobs, products, tenants } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryRateLimiter, rateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { COLLECT_LIMITS, MAX_BATCH_BYTES, ROLLUP_EVERY_MS, collect, collectResponse, collectorCounts, deviceOf, pageHost, placeOf, readCapped, resetCollector } from '@/server/modules/analytics/ingest';
import { createTracker } from '@/widget/src/track';
import { LIMITS, type EventBatch, type TrackInput } from '@/widget/src/events';

setLogLevel('error');
const SECRET = 's'.repeat(40);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const NOW = new Date('2026-10-01T09:00:00Z'); // 12:00 in Riyadh
const TOKEN = 'tok_0123456789abcdef';

/** What the widget's SDK puts on the wire for these calls — the real one, with a stand-in beacon. */
function sdkBatch(store: string, inputs: TrackInput[], session = TOKEN): string {
  const sent: string[] = [];
  let clock = 1_790_000_000_000;
  const tracker = createTracker({
    endpoint: 'https://ev.tajribah.com/v1/e', store, sdk: '1.0.0', session, now: () => (clock += 250),
    beacon: (_url, body) => { sent.push(typeof body === 'string' ? body : '(blob)'); return true; },
    onSend: (batch) => { sent[sent.length - 1] = JSON.stringify(batch); },
  });
  for (const input of inputs) tracker.track(input);
  tracker.flush();
  assert.equal(sent.length, 1, 'one batch');
  return sent[0]!;
}

function post(body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
  return new Request('https://ev.tajribah.com/v1/e', {
    method: 'POST', body, duplex: 'half',
    headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': IPHONE, 'cf-connecting-ip': '203.0.113.7', 'cf-ipcountry': 'SA', origin: 'https://shop.example.sa', ...headers },
  } as RequestInit);
}

const stored = (harness: TestDb) => harness.asAdmin(() => harness.db.select().from(analyticsEvents));

async function shop(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const withRef = uuidv7();
  const plain = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values([
    { id: withRef, tenantId: seeded.tenantId, name: 'Oud 41', externalId: 'sku-41' },
    { id: plain, tenantId: seeded.tenantId, name: 'Made in the dashboard' },
  ] as any));
  return { ...seeded, withRef, plain };
}

test('a shop’s batch, as the SDK sends it, becomes this store’s rows — and nothing that identifies a shopper', async () => {
  const harness = await createTestDb();
  resetCollector(); setRateLimiter(new MemoryRateLimiter());
  try {
    const a = await shop(harness, 'oud-shop');
    const b = await shop(harness, 'pearl-shop');
    const body = sdkBatch('oud-shop', [
      { type: 'product_view', productId: 'sku-41', arSupported: true },
      { type: 'ar_open', productId: 'sku-41', arSupported: true },
      { type: 'product_view', productId: a.plain },
      { type: 'product_view', productId: 'not-in-this-store' },
      { type: 'product_view', productId: b.plain }, // another store's product id: not this store's
      { type: 'purchase', valueMinor: 159_900, currency: 'sar', properties: { coupon: 'EID', email: 'someone@example.com' } },
    ]);
    assert.equal(await collect(post(body, { 'cf-region-code': '01', referer: 'https://shop.example.sa/p/41?utm=1' }), { secret: SECRET, now: NOW }), 'accepted');

    const rows = (await stored(harness)).sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime());
    assert.equal(rows.length, 6);
    assert.ok(rows.every((r) => r.tenantId === a.tenantId), 'the store the key names, whatever the batch says');
    assert.deepEqual(rows.map((r) => [r.eventType, r.productId]), [
      ['product_view', a.withRef], ['ar_open', a.withRef], ['product_view', a.plain],
      ['product_view', null], ['product_view', null], ['purchase', null],
    ], 'the merchant’s own reference, or the product’s id when it has none; anything else is no product');
    assert.deepEqual([rows[5]!.valueMinor, rows[5]!.currency, rows[5]!.properties], [159_900, 'SAR', { coupon: 'EID' }], 'the SDK had already dropped the email');
    assert.deepEqual([rows[0]!.arSupported, rows[2]!.arSupported], [1, 0]);
    assert.ok(rows.every((r) => r.deviceType === 'mobile' && r.os === 'iOS' && r.browser === 'Safari' && r.country === 'SA' && r.region === '01' && r.referrerHost === 'shop.example.sa'));

    // The time is this server's, walked back by the event's place in its batch (250 ms apart).
    assert.equal(rows[5]!.occurredAt.getTime(), NOW.getTime(), 'the last event: when the batch arrived');
    assert.equal(rows[0]!.occurredAt.getTime(), NOW.getTime() - 5 * 250);

    // The session: one id for the batch, not the token; another day, another store → unrelated ids.
    const session = rows[0]!.sessionId;
    assert.ok(rows.every((r) => r.sessionId === session) && session !== TOKEN && !session.includes(TOKEN) && session.length >= 40);
    await collect(post(sdkBatch('oud-shop', [{ type: 'add_to_cart', productId: 'sku-41' }])), { secret: SECRET, now: new Date(NOW.getTime() + 60_000) });
    await collect(post(sdkBatch('oud-shop', [{ type: 'add_to_cart', productId: 'sku-41' }])), { secret: SECRET, now: new Date('2026-10-01T21:00:00Z') }); // 00:00 on the 2nd in Riyadh
    await collect(post(sdkBatch('pearl-shop', [{ type: 'product_view', productId: b.plain }])), { secret: SECRET, now: NOW });
    const later = await stored(harness);
    const carts = later.filter((r) => r.eventType === 'add_to_cart').sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime());
    assert.equal(carts[0]!.sessionId, session, 'the same tab, the same Riyadh day: the same visit');
    assert.notEqual(carts[1]!.sessionId, session, 'the next day the same tab is a stranger');
    const other = later.find((r) => r.tenantId === b.tenantId)!;
    assert.notEqual(other.sessionId, session, 'and in another shop too');
    assert.equal(other.productId, b.plain);

    // Nothing of the request that could point at a person is anywhere in a row.
    const dump = JSON.stringify(later);
    for (const secretish of ['203.0.113.7', 'iPhone OS 18_5', 'Mozilla', TOKEN, 'someone@example.com', 'utm=1', '/p/41']) assert.ok(!dump.includes(secretish), secretish);
  } finally { await harness.close(); }
});

test('the body is capped before it is read; a batch is taken whole or not at all', async () => {
  const harness = await createTestDb();
  resetCollector(); setRateLimiter(new MemoryRateLimiter());
  try {
    await shop(harness, 'oud-shop');
    const good = sdkBatch('oud-shop', [{ type: 'product_view', productId: 'sku-41' }]);
    const take = (request: Request) => collect(request, { secret: SECRET, now: NOW });

    // Content-Length says too much: refused without touching the stream.
    let pulled = 0;
    const untouched = new ReadableStream<Uint8Array>({ pull(c) { pulled += 1; if (pulled > 400) c.close(); else c.enqueue(new Uint8Array(1024)); } });
    assert.equal(await take(post(untouched, { 'content-length': String(MAX_BATCH_BYTES + 1) })), 'too_large');
    assert.equal(pulled <= 1, true, 'nothing was read to decide (a stream may pre-fill one chunk)');

    // No Content-Length (or a false one): the stream is stopped at the cap, not drained.
    // (A long stream, not an endless one: if the cap were ever lost, this test must fail, not hang.)
    let chunks = 0;
    const long = new ReadableStream<Uint8Array>({ pull(c) { chunks += 1; if (chunks > 400) c.close(); else c.enqueue(new Uint8Array(8 * 1024)); } });
    assert.equal(await readCapped(post(long, { 'content-length': '10' })), null);
    assert.ok(chunks <= MAX_BATCH_BYTES / (8 * 1024) + 3, `stopped after ${chunks} chunks`);

    // The SDK's own rule is characters: more than it would ever send is refused even under the byte cap…
    assert.equal(await take(post(JSON.stringify({ pad: 'x'.repeat(LIMITS.bodyBytes) }))), 'too_large');
    // …and an Arabic batch the SDK does send — few characters, more bytes — is taken.
    const arabic = sdkBatch('oud-shop', Array.from({ length: 20 }, () => ({ type: 'product_view', productId: 'sku-41', properties: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, 'ساعة'.repeat(16)])) })));
    assert.ok(arabic.length <= LIMITS.bodyBytes && new TextEncoder().encode(arabic).length > LIMITS.bodyBytes, 'under the SDK’s cap in characters, over it in bytes');
    assert.equal(await take(post(arabic)), 'accepted');
    assert.equal((await stored(harness)).length, 20);

    assert.equal(await take(post('{not json')), 'not_json');
    assert.equal(await take(post('')), 'not_json');
    assert.equal(await take(post('[]')), 'invalid');
    const batch = JSON.parse(good) as EventBatch;
    const broken = (change: (b: any) => void) => { const copy = JSON.parse(good); change(copy); return JSON.stringify(copy); };
    for (const [why, body] of [
      ['an unknown event type', broken((b) => { b.events.push({ type: 'login', t: 0 }); })],
      ['a field the contract does not know', broken((b) => { b.events[0].email = 'a@b.co'; })],
      ['a session that is not a token', broken((b) => { b.session = 'x'; })],
      ['too many events', broken((b) => { b.events = Array.from({ length: LIMITS.batch + 1 }, () => batch.events[0]); })],
      ['a later schema', broken((b) => { b.v = 2; })],
    ] as const) assert.equal(await take(post(body)), 'invalid', why);
    assert.equal((await stored(harness)).length, 20, 'a batch with one bad event stores none of its events');

    assert.deepEqual([collectResponse('accepted').status, collectResponse('too_large').status, collectResponse('not_json').status, collectResponse('invalid').status], [204, 413, 400, 400]);
    for (const quiet of ['unknown_store', 'store_off', 'robot', 'limited_visitor', 'limited_store'] as const) assert.equal(collectResponse(quiet).status, 204, `${quiet}: nothing to learn from the answer`);
    assert.equal(await collectResponse('invalid').text(), '', 'and never an echo of the body');
  } finally { await harness.close(); }
});

test('the store key first: unknown, closed or malformed keys cost a lookup at most and store nothing; robots are not shoppers', async () => {
  const harness = await createTestDb();
  resetCollector(); setRateLimiter(new MemoryRateLimiter());
  try {
    const a = await shop(harness, 'oud-shop');
    const held = await shop(harness, 'held-shop');
    await harness.asAdmin(() => harness.db.update(tenants).set({ status: 'suspended' } as any).where(eq(tenants.id, held.tenantId)));
    const take = (body: string, headers?: Record<string, string>) => collect(post(body, headers), { secret: SECRET, now: NOW });
    const view = (store: string) => sdkBatch(store, [{ type: 'product_view', productId: 'sku-41' }]);

    assert.equal(await take(view('no-such-shop')), 'unknown_store');
    assert.equal(await take(view('Oud-Shop')), 'unknown_store', 'a key is exact');
    assert.equal(await take(view("x' or 1=1 --")), 'unknown_store', 'not shaped like a key: not even looked up');
    assert.equal(await take(JSON.stringify({ store: 'no-such-shop', events: 'nonsense' })), 'unknown_store', 'the key is judged before the rest of the batch');
    assert.equal(await take(JSON.stringify({ store: 7 })), 'invalid');
    assert.equal(await take(view('held-shop')), 'store_off', 'a suspended store collects nothing');

    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/126.0', 'curl/8.7.1', 'Mozilla/5.0 (compatible; bingbot/2.0)'])
      assert.equal(await take(view('oud-shop'), { 'user-agent': ua }), 'robot', ua);
    assert.equal((await stored(harness)).length, 0);

    // A store that was unknown a moment ago and now exists is found within the minute it is remembered for.
    await shop(harness, 'new-shop');
    assert.equal(await take(view('new-shop')), 'accepted');
    assert.equal(await take(view('oud-shop'), { origin: '', 'cf-ipcountry': 'XX', 'user-agent': 'SomethingNew/1.0' }), 'accepted', 'no Origin, no country, an unknown device: still a shopper');
    const row = (await stored(harness)).find((r) => r.tenantId === a.tenantId)!;
    assert.deepEqual([row.referrerHost, row.country, row.deviceType, row.os, row.browser], [null, null, 'unknown', null, null]);
    assert.deepEqual([collectorCounts().unknown_store, collectorCounts().store_off, collectorCounts().robot, collectorCounts().accepted, collectorCounts().invalid], [4, 1, 4, 2, 1], 'every drop is counted');
  } finally { await harness.close(); }
});

test('rate limits: per store and visitor, and per store — dropped quietly; a limiter that fails loses no events', async () => {
  const harness = await createTestDb();
  resetCollector(); setRateLimiter(new MemoryRateLimiter());
  try {
    const a = await shop(harness, 'oud-shop');
    await shop(harness, 'pearl-shop');
    const view = (store = 'oud-shop') => sdkBatch(store, [{ type: 'product_view', productId: 'sku-41' }]);
    const limits = { visitor: { limit: 3, windowSeconds: 60 }, store: { limit: 8, windowSeconds: 60 } };
    const take = (ip: string, store?: string) => collect(post(view(store), { 'cf-connecting-ip': ip }), { secret: SECRET, now: NOW, limits });

    assert.deepEqual([COLLECT_LIMITS.visitor.limit, COLLECT_LIMITS.store.limit], [60, 1200], 'the agreed starting numbers');
    for (let i = 0; i < 3; i++) assert.equal(await take('203.0.113.7'), 'accepted');
    assert.equal(await take('203.0.113.7'), 'limited_visitor', 'the fourth batch in a minute from one address');
    assert.equal(await take('203.0.113.8'), 'accepted', 'another address in the same shop is unaffected');
    assert.equal(await take('203.0.113.7', 'pearl-shop'), 'accepted', 'and the same address in another shop: limits are per store (carrier NAT)');

    // The store's own cap: eight accepted or visitor-limited hits reach it… the ninth is a flood.
    for (const ip of ['203.0.113.9', '203.0.113.10', '203.0.113.11', '203.0.113.12']) await take(ip);
    assert.equal(collectorCounts().accepted, 3 + 1 + 1 + 4);
    assert.equal(await take('203.0.113.13'), 'limited_store', 'the store is over its cap: a new visitor is dropped too');
    assert.equal(await take('203.0.113.13', 'pearl-shop'), 'accepted', 'the other shop is not');
    assert.equal((await stored(harness)).filter((r) => r.tenantId === a.tenantId).length, 8, 'only what was accepted is stored');

    // The visitor key is the address hashed with the day: nothing in the limiter names an address.
    const keys: string[] = [];
    setRateLimiter({ async hit(key) { keys.push(key); return { allowed: true, remaining: 1, retryAfter: 1 }; }, async reset() {} });
    resetCollector();
    await take('198.51.100.20');
    assert.ok(keys.length === 1 && keys[0]!.startsWith(`collect:${a.tenantId}:`) && !keys[0]!.includes('198.51.100.20'), keys[0]);

    setRateLimiter({ async hit() { throw new Error('KV is down'); }, async reset() {} });
    assert.equal(await take('198.51.100.21'), 'accepted', 'the shared limiter failing does not lose a shop’s events');
  } finally { setRateLimiter(new MemoryRateLimiter()); await harness.close(); }
});

test('after the rows, a roll-up of the day is queued — once per store per day per window', async () => {
  const harness = await createTestDb();
  resetCollector(); setRateLimiter(new MemoryRateLimiter());
  try {
    const a = await shop(harness, 'oud-shop');
    await shop(harness, 'pearl-shop');
    const view = (store: string) => sdkBatch(store, [{ type: 'product_view', productId: 'sku-41' }]);
    const at = (ms: number, store = 'oud-shop', ip = '203.0.113.7') => collect(post(view(store), { 'cf-connecting-ip': ip }), { secret: SECRET, now: new Date(NOW.getTime() + ms) });
    const queued = async () => (await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.queue, 'analytics.rollup'))))
      .sort((x, y) => x.runAfter.getTime() - y.runAfter.getTime() || String(x.tenantId).localeCompare(String(y.tenantId)));

    await at(0); await at(1000, 'oud-shop', '203.0.113.8'); await at(2000);
    let all = await queued();
    assert.equal(all.length, 1, 'three batches, one job');
    assert.deepEqual([all[0]!.tenantId, all[0]!.payload && (all[0]!.payload as any).day, all[0]!.state], [a.tenantId, '2026-10-01', 'queued']);
    const due = (Math.floor(NOW.getTime() / ROLLUP_EVERY_MS) + 1) * ROLLUP_EVERY_MS;
    assert.equal(all[0]!.runAfter.getTime(), due, 'due when the window closes: every event written before it runs is in it');
    assert.ok(due > NOW.getTime() + 2000);

    // Another isolate (nothing remembered) asking for the same window adds nothing: the key decides.
    resetCollector();
    await at(3000);
    assert.equal((await queued()).length, 1);

    // A batch arriving just after midnight in Riyadh carries events from before it: both days are rolled up.
    const straddle = sdkBatch('oud-shop', Array.from({ length: 6 }, () => ({ type: 'product_view', productId: 'sku-41' })));
    await collect(post(straddle, { 'cf-connecting-ip': '198.51.100.30' }), { secret: SECRET, now: new Date('2026-10-01T21:00:00.500Z') });
    const around = (await queued()).filter((j) => j.runAfter.getTime() === new Date('2026-10-01T21:05:00Z').getTime());
    assert.deepEqual(around.map((j) => (j.payload as any).day).sort(), ['2026-10-01', '2026-10-02'], 'one window, two days, two jobs');
    await harness.asAdmin(() => harness.db.delete(jobs).where(eq(jobs.queue, 'analytics.rollup')));
    await harness.asAdmin(() => harness.db.insert(jobs).values(all as any));
    resetCollector();

    await at(ROLLUP_EVERY_MS); // the next window
    await at(4000, 'pearl-shop'); // another store
    await at(new Date('2026-10-01T21:00:00Z').getTime() - NOW.getTime()); // the next Riyadh day
    all = await queued();
    assert.equal(all.length, 4);
    assert.deepEqual(all.map((j) => (j.payload as any).day).sort(), ['2026-10-01', '2026-10-01', '2026-10-01', '2026-10-02']);
    assert.equal(new Set(all.map((j) => j.dedupeKey)).size, 4);
    void rateLimiter;
  } finally { await harness.close(); }
});

test('what is derived from the request: device, system and browser family; the page’s host; the country', () => {
  const d = (ua: string) => { const { robot, deviceType, os, browser } = deviceOf(ua); return [robot, deviceType, os, browser]; };
  assert.deepEqual(d(IPHONE), [false, 'mobile', 'iOS', 'Safari']);
  assert.deepEqual(d('Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'), [false, 'mobile', 'Android', 'Chrome']);
  assert.deepEqual(d('Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36'), [false, 'mobile', 'Android', 'Samsung Internet']);
  assert.deepEqual(d('Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'), [false, 'tablet', 'Android', 'Chrome']);
  assert.deepEqual(d('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1'), [false, 'tablet', 'iOS', 'Chrome']);
  assert.deepEqual(d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'), [false, 'desktop', 'Windows', 'Edge']);
  assert.deepEqual(d('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0'), [false, 'desktop', 'macOS', 'Firefox']);
  assert.deepEqual(d('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0'), [false, 'desktop', 'Linux', 'Opera']);
  assert.deepEqual(deviceOf(null), { robot: false, deviceType: 'unknown', os: null, browser: null });

  const h = (headers: Record<string, string>) => new Headers(headers);
  assert.equal(pageHost(h({ origin: 'https://Shop.Example.sa' })), 'shop.example.sa');
  assert.equal(pageHost(h({ origin: 'null', referer: 'https://shop.example.sa/p/41?x=1' })), 'shop.example.sa', 'a page that hides its origin: the referrer’s host, never its path');
  assert.equal(pageHost(h({ referer: 'not a url' })), null);
  assert.equal(pageHost(h({})), null);
  assert.deepEqual(placeOf(h({ 'cf-ipcountry': 'sa', 'cf-region-code': '01' })), { country: 'SA', region: '01' });
  assert.deepEqual(placeOf(h({ 'cf-ipcountry': 'T1' })), { country: null, region: null }, 'Tor and unknown are not countries');
  assert.deepEqual(placeOf(h({ 'cf-ipcountry': 'Saudi Arabia', 'cf-region-code': 'Riyadh Province' })), { country: null, region: null });
});
