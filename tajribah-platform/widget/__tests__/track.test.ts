import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, LIMITS, looksPersonal, sanitize } from '../src/events';
import type { EventBatch } from '../src/events';
import { createTracker, privacySignal, randomToken, sessionToken, type TrackerEnv } from '../src/track';
import { startTracking } from '../src/main';
import { parseBatch, toRow } from '../../lib/contracts/analytics';
import { EVENT_TYPE } from '../../db/schema/analytics';

/** A tracker whose world is a fake: a clock we move, a beacon we watch, no browser. */
function harness(over: Partial<TrackerEnv> = {}) {
  const sent: EventBatch[] = [];
  let clock = 1_000;
  const beaconCalls: string[] = [];
  const env: TrackerEnv = {
    endpoint: 'https://ev.example.test/v1/e',
    store: 'store_abc',
    sdk: '1.0.0',
    session: 'Gm9ZqR4tUv2wXy7A',
    now: () => clock,
    beacon: (url, body) => { beaconCalls.push(url); void body; return true; },
    onSend: (batch) => sent.push(batch),
    ...over,
  };
  return { env, sent, beaconCalls, tick: (ms: number) => { clock += ms; }, tracker: createTracker(env) };
}

test('an event is only what the contract allows: unknown types, junk and over-long values go', () => {
  for (const type of EVENT_TYPES) assert.equal(sanitize({ type }, 0)?.type, type);
  for (const junk of [null, undefined, 42, 'product_view', [], {}, { type: 'page_view' }, { type: 'PRODUCT_VIEW' }]) {
    assert.equal(sanitize(junk, 0), null, `${JSON.stringify(junk)} must be refused`);
  }
  const wide = sanitize({
    type: 'purchase',
    productId: 'x'.repeat(LIMITS.productId + 1),
    durationMs: LIMITS.durationMs + 1,
    valueMinor: LIMITS.value + 1,
    currency: 'riyal',
  }, 0)!;
  assert.deepEqual([wide.productId, wide.durationMs, wide.valueMinor, wide.currency], [undefined, undefined, undefined, undefined],
    'a value past its limit is dropped, never truncated into a different value');

  const good = sanitize({ type: 'purchase', productId: ' sku-9 ', valueMinor: 45_000, currency: 'sar', arSupported: true, durationMs: 1200 }, 7)!;
  assert.deepEqual(good, { type: 'purchase', t: 7, productId: 'sku-9', durationMs: 1200, valueMinor: 45_000, currency: 'SAR', arSupported: 1 });

  // Three characters is not enough to be a currency — it has to be three *letters*.
  for (const currency of ['1SR', 's a', 'ر.س', '$$$', 'riyal']) {
    assert.equal(sanitize({ type: 'purchase', currency }, 0)!.currency, undefined, `${currency} is not ISO 4217`);
  }
});

test('properties: a merchant’s short strings only, and nothing that looks like a person', () => {
  const event = sanitize({
    type: 'add_to_cart',
    properties: {
      variant: 'gold',
      collection: 'ramadan',
      Bad_Key: 'dropped',
      '': 'dropped',
      email: 'someone@example.com',
      phone: '+966 50 123 4567',
      order_ref: '4451 9982 7731',
      long: 'x'.repeat(LIMITS.propValue + 1),
      count: 3,
      flag: true,
    },
  }, 0)!;
  assert.deepEqual(event.properties, { variant: 'gold', collection: 'ramadan', count: '3', flag: 'true' });

  assert.equal(looksPersonal('someone@example.com'), true);
  assert.equal(looksPersonal('0501234567'), true);
  assert.equal(looksPersonal('gold'), false);
  assert.equal(looksPersonal('41mm'), false, 'a size is not a phone number');

  const many: Record<string, string> = {};
  for (let i = 0; i < LIMITS.props + 5; i += 1) many[`k${i}`] = 'v';
  assert.equal(Object.keys(sanitize({ type: 'ar_open', properties: many }, 0)!.properties!).length, LIMITS.props);
});

test('a batch leaves when it is full, and carries offsets rather than a browser clock', () => {
  const h = harness();
  for (let i = 0; i < LIMITS.batch - 1; i += 1) { h.tracker.track({ type: 'product_view', productId: `p${i}` }); h.tick(10); }
  assert.equal(h.sent.length, 0, `${LIMITS.batch - 1} events must still be waiting`);
  assert.equal(h.tracker.pending(), LIMITS.batch - 1);

  h.tracker.track({ type: 'ar_open', productId: 'p19' });
  assert.equal(h.sent.length, 1, 'the batch goes at exactly the batch size');
  assert.equal(h.tracker.pending(), 0);

  const batch = h.sent[0]!;
  assert.equal(batch.events.length, LIMITS.batch);
  assert.deepEqual(batch.events.map((e) => e.t).slice(0, 3), [0, 10, 20], 'offsets from when the batch opened');
  assert.equal(batch.store, 'store_abc');
  assert.equal(batch.session, 'Gm9ZqR4tUv2wXy7A');
  assert.ok(!JSON.stringify(batch).includes('1000'), 'no absolute local clock reading rides along in an event');
});

test('what the SDK sends is exactly what the collector accepts', () => {
  const h = harness();
  h.tracker.track({ type: 'product_view', productId: 'sku-1', arSupported: false });
  h.tick(250);
  h.tracker.track({ type: 'purchase', productId: 'sku-1', valueMinor: 129_900, currency: 'SAR', properties: { variant: 'gold' } });
  assert.equal(h.tracker.flush(), true);

  const parsed = parseBatch(h.sent[0]);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.reason);
  if (!parsed.ok) return;

  // And the collector's row mapping keeps the money in minor units and takes its own clock.
  const receivedAt = new Date('2026-09-27T10:00:00.000Z');
  const batch = parsed.batch;
  const ctx = { tenantId: 't1', sessionId: 'hashed', receivedAt, productId: 'product-uuid', country: 'SA' };
  const rows = batch.events.map((e) => toRow(e, batch, ctx));
  assert.equal(rows[1]!.valueMinor, 129_900);
  assert.equal(rows[1]!.occurredAt!.toISOString(), receivedAt.toISOString(), 'the last event happened when the batch arrived');
  assert.equal(rows[0]!.occurredAt!.toISOString(), new Date(receivedAt.getTime() - 250).toISOString(), 'earlier events, earlier');
  assert.equal(rows[0]!.sessionId, 'hashed', 'the raw token is never a column');
  // The browser said "sku-1"; the column takes this store's uuid, resolved by the collector.
  assert.equal(rows[0]!.productId, 'product-uuid');
  assert.equal(rows[0]!.deviceType, 'unknown', 'what the edge did not derive is not invented');
});

test('every type the SDK can send is a type the column can store', () => {
  // The reverse is allowed: `ar_close` and `tryon_share` exist as columns with nothing
  // observing them yet. This is the direction that would lose data.
  for (const type of EVENT_TYPES) {
    assert.ok((EVENT_TYPE as readonly string[]).includes(type), `the event_type column cannot hold ${type}`);
  }
});

test('the collector refuses a batch whole: bad version, unknown fields, too many events, a bad session', () => {
  const h = harness();
  h.tracker.track({ type: 'product_view' });
  h.tracker.flush();
  const good = h.sent[0]!;
  const bad: [string, unknown][] = [
    ['v', 2],
    ['store', ''],
    ['session', 'short'],
    ['session', 'has spaces in it!!'],
    ['events', []],
    ['events', Array.from({ length: LIMITS.batch + 1 }, () => ({ type: 'ar_open', t: 0 }))],
    ['events', [{ type: 'product_view', t: 0, ip: '1.2.3.4' }]],
    ['events', [{ type: 'page_view', t: 0 }]],
    ['events', [{ type: 'product_view', t: -1 }]],
  ];
  for (const [key, value] of bad) {
    const copy = { ...JSON.parse(JSON.stringify(good)), [key]: value };
    assert.equal(parseBatch(copy).ok, false, `${key}=${JSON.stringify(value)} must be refused`);
  }
  assert.equal(parseBatch({ ...JSON.parse(JSON.stringify(good)), extra: 1 }).ok, false, 'an unknown top-level field is refused');
  for (const junk of [null, 'x', 7, []]) assert.equal(parseBatch(junk).ok, false);
});

test('privacy signals and consent stop events at the door — they are not queued for later', () => {
  const dnt = harness({ doNotTrack: true });
  dnt.tracker.track({ type: 'product_view' });
  assert.equal(dnt.tracker.pending(), 0);
  assert.equal(dnt.tracker.flush(), false);
  assert.equal(dnt.sent.length, 0);
  assert.equal(dnt.tracker.dropped(), 1);

  const gated = harness({ consent: 'required' });
  gated.tracker.track({ type: 'product_view', productId: 'before' });
  assert.equal(gated.tracker.pending(), 0, 'nothing is held while consent is missing');
  gated.tracker.setConsent('granted');
  gated.tracker.track({ type: 'product_view', productId: 'after' });
  gated.tracker.flush();
  assert.deepEqual(gated.sent[0]!.events.map((e: { productId?: string }) => e.productId), ['after'], 'granting consent does not back-fill');

  assert.equal(privacySignal({ doNotTrack: '1' }), true);
  assert.equal(privacySignal({ globalPrivacyControl: true }), true);
  assert.equal(privacySignal({}, { doNotTrack: 'yes' }), true);
  assert.equal(privacySignal({ doNotTrack: '0' }, { doNotTrack: null }), false);
});

test('a page that never unloads does not grow: an undeliverable batch is dropped, not retried', () => {
  const h = harness({ beacon: undefined, fetchImpl: undefined }); // nothing can leave this page
  for (let i = 0; i < 500; i += 1) h.tracker.track({ type: 'product_view', productId: `p${i}` });
  assert.ok(h.tracker.pending() < LIMITS.batch,
    `after 500 undeliverable events, ${h.tracker.pending()} are waiting — a failed send must empty the queue, never hold it`);
  // 500 events, batches of 20, none delivered: 25 attempts were made and each one let go.
  assert.equal(h.sent.length, 25);
  assert.equal(h.sent.every((b) => b.events.length === LIMITS.batch), true);
});

test('the batch goes as text, so a cross-origin beacon needs no preflight it cannot do', async () => {
  // CORS-safelisted content types, the only ones a simple request may carry.
  const SAFELISTED = ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'];
  let beaconType = '';
  let fetchType = '';
  const h = harness({
    beacon: (_url, blobOrString) => { beaconType = (blobOrString as Blob).type ?? ''; return true; },
    fetchImpl: (async (_u: string, init: RequestInit) => {
      fetchType = String((init.headers as Record<string, string>)['content-type']);
      return new Response('', { status: 204 });
    }) as unknown as typeof fetch,
  });
  h.tracker.track({ type: 'product_view', productId: 'sku-1' });
  h.tracker.flush();
  assert.ok(SAFELISTED.some((t) => beaconType.startsWith(t)),
    `the beacon sent ${beaconType || '(no type)'} — anything outside ${SAFELISTED.join(', ')} preflights, and a beacon cannot preflight`);

  // The fallback has to be a simple request too: on pagehide it will not finish a preflight.
  const refusing = harness({
    beacon: () => false,
    fetchImpl: (async (_u: string, init: RequestInit) => {
      fetchType = String((init.headers as Record<string, string>)['content-type']);
      return new Response('', { status: 204 });
    }) as unknown as typeof fetch,
  });
  refusing.tracker.track({ type: 'product_view' });
  refusing.tracker.flush();
  assert.ok(SAFELISTED.some((t) => fetchType.startsWith(t)), `the fetch fallback sent ${fetchType}`);

  // And what the collector parses out of that text is still the batch it expects.
  const parsed = parseBatch(JSON.parse(JSON.stringify(h.sent[0])));
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.reason);
});

test('delivery: the beacon first, fetch when it refuses, and silence when neither works', () => {
  let fetched = 0;
  const refused = harness({
    beacon: () => false,
    fetchImpl: (async () => { fetched += 1; return new Response('', { status: 202 }); }) as typeof fetch,
  });
  refused.tracker.track({ type: 'ar_open' });
  assert.equal(refused.tracker.flush(), true, 'fetch keepalive picks up what the beacon refused');
  assert.equal(fetched, 1);

  const throws = harness({ beacon: () => { throw new Error('blocked by an extension'); }, fetchImpl: undefined });
  throws.tracker.track({ type: 'ar_open' });
  assert.equal(throws.tracker.flush(), false, 'a blocked beacon is a dropped batch, never an exception');

  const empty = harness();
  assert.equal(empty.tracker.flush(), false, 'an empty queue sends nothing');
  assert.equal(empty.sent.length, 0);
});

test('nothing the SDK is handed can make it throw', () => {
  const hostile = {
    get type() { throw new Error('hostile getter'); },
  };

  // Each layer answers for itself: `sanitize` promises never to throw, and the tracker
  // promises the same even if `sanitize` were to break that promise.
  assert.doesNotThrow(() => sanitize(hostile, 0));
  assert.equal(sanitize(hostile, 0), null);
  assert.equal(sanitize({ type: 'ar_open', get properties() { throw new Error('nope'); } }, 0), null);

  // And one the tracker alone can catch, since `sanitize` is never reached.
  const brokenClock = harness({ now: () => { throw new Error('the page replaced Date.now'); } });
  assert.doesNotThrow(() => brokenClock.tracker.track({ type: 'ar_open' }));
  assert.equal(brokenClock.sent.length, 0);

  const h = harness();
  assert.doesNotThrow(() => h.tracker.track(hostile as never));
  assert.doesNotThrow(() => h.tracker.track({ type: 'product_view', properties: { get bad() { throw new Error('nope'); } } as never }));
  assert.equal(h.tracker.pending(), 0);
  assert.equal(h.tracker.dropped(), 2);
});

test('the page is wired to leave with the shopper, on the cadence LIMITS declares', () => {
  // A window thin enough to build a tracker against, and watchful enough to say what was wired.
  const listeners: string[] = [];
  const docListeners: string[] = [];
  let interval = -1;
  const win = {
    navigator: { sendBeacon: () => true, doNotTrack: null },
    document: { addEventListener: (k: string) => { docListeners.push(k); }, visibilityState: 'visible' },
    addEventListener: (k: string) => { listeners.push(k); },
    setInterval: (_fn: () => void, ms: number) => { interval = ms; return 1; },
    fetch: (async () => new Response('', { status: 204 })) as unknown as typeof fetch,
    sessionStorage: undefined,
    crypto: undefined,
  } as unknown as Window & typeof globalThis;

  const tracker = startTracking(win, {
    store: 'store_abc', configBase: '/cfg', viewer: '/v.js', events: 'https://ev.example.test/e', consent: 'granted',
  } as never);

  assert.ok(listeners.includes('pagehide'), 'a shopper who converts closes the tab');
  assert.ok(docListeners.includes('visibilitychange'), 'and on mobile they switch away rather than close');
  assert.equal(interval, LIMITS.flushMs,
    'the interval must come from LIMITS — the collector\u2019s rate limits are sized from it');
  assert.equal(typeof tracker.track, 'function');
});

test('the session token lives for one tab and is random; blocked storage is not an error', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  } as unknown as Storage;

  const first = sessionToken(storage, () => randomToken());
  assert.match(first, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(sessionToken(storage, () => randomToken()), first, 'the same tab keeps its token');
  assert.notEqual(randomToken(), randomToken());

  store.set('tj_s', 'not a token!!');
  assert.notEqual(sessionToken(storage, () => randomToken()), 'not a token!!', 'a tampered token is replaced');

  const blocked = { getItem: () => { throw new Error('private mode'); }, setItem: () => { throw new Error('private mode'); } } as unknown as Storage;
  assert.match(sessionToken(blocked, () => randomToken()), /^[A-Za-z0-9_-]{16,64}$/);
  assert.match(sessionToken(undefined, () => randomToken()), /^[A-Za-z0-9_-]{16,64}$/);
});

test('an oversized body is dropped rather than sent', () => {
  const h = harness();
  const long = 'v'.repeat(LIMITS.propValue);
  const props: Record<string, string> = {};
  for (let i = 0; i < LIMITS.props; i += 1) props[`k${i}`] = long;
  // Fill a full batch of the largest events the contract allows.
  for (let i = 0; i < LIMITS.batch; i += 1) {
    h.tracker.track({ type: 'purchase', productId: 'p'.repeat(LIMITS.productId), valueMinor: LIMITS.value, currency: 'SAR', properties: props });
  }
  const body = h.sent.length > 0 ? JSON.stringify(h.sent[0]) : '';
  assert.ok(body.length <= LIMITS.bodyBytes,
    `a full batch of maximal events is ${body.length} bytes; the cap is ${LIMITS.bodyBytes} — lower LIMITS.batch or raise the cap`);
});
