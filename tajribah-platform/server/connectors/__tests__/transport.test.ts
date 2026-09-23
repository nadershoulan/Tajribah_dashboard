/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setLogLevel } from '@/server/core/observability/log';
import { Transport, type Clock, type TransportOptions } from '@/server/connectors/transport';

setLogLevel('error');

type Handler = (req: IncomingMessage, res: ServerResponse, hit: number) => void;

/** A store API on localhost. `hits` counts requests that actually arrived. */
async function fakeStore(handler: Handler) {
  let hits = 0;
  const server = createServer((req, res) => { hits += 1; handler(req, res, hits); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/products`,
    get hits() { return hits; },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

/** Time only moves when the transport sleeps; every sleep is recorded. */
function fakeClock(): Clock & { sleeps: number[]; advance(ms: number): void } {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    random: () => 0.5,
    advance: (ms) => { t += ms; },
  };
}

const transport = (options: TransportOptions, clock = fakeClock()) => ({ t: new Transport('salla', options, undefined, clock), clock });
const reply = (status: number, headers: Record<string, string> = {}): Handler => (_req, res) => { res.writeHead(status, headers); res.end('{}'); };
const code = (e: any) => e.code;

test('timeout: a store that never answers is abandoned, and a GET is retried once more', async () => {
  const store = await fakeStore(() => { /* never answers */ });
  try {
    const { t } = transport({ timeoutMs: 50, maxAttempts: 2 });
    const started = Date.now();
    await assert.rejects(() => t.send('c1', store.url), (e: any) => code(e) === 'upstream_timeout');
    assert.equal(store.hits, 2);
    assert.ok(Date.now() - started < 2_000, 'two 50 ms timeouts, not the default 10 s');
  } finally { await store.close(); }
});

test('retry: transient answers on a GET are retried with backoff until it works', async () => {
  const store = await fakeStore((req, res, hit) => reply(hit < 3 ? 503 : 200)(req, res, hit));
  try {
    const { t, clock } = transport({ baseDelayMs: 100 });
    const res = await t.send('c1', store.url);
    assert.equal(res.status, 200);
    assert.equal(store.hits, 3);
    assert.deepEqual(clock.sleeps, [50, 100], 'full jitter at random=0.5 of 100, then 200');
  } finally { await store.close(); }
});

test('retry: a store-side Retry-After wins over our own backoff', async () => {
  const store = await fakeStore((req, res, hit) => (hit === 1 ? reply(429, { 'retry-after': '2' }) : reply(200))(req, res, hit));
  try {
    const { t, clock } = transport({});
    assert.equal((await t.send('c1', store.url)).status, 200);
    assert.deepEqual(clock.sleeps, [2000]);
  } finally { await store.close(); }
});

test('retry: never for a POST the store received, nor for a plain 500, nor for a 4xx', async () => {
  const store = await fakeStore((req, res, hit) => {
    const status = req.method === 'POST' ? 503 : req.url === '/products?boom' ? 500 : 404;
    reply(status)(req, res, hit);
  });
  try {
    const { t } = transport({ failureThreshold: 99 });
    assert.equal((await t.send('c1', store.url, { method: 'POST', body: '{}' })).status, 503);
    assert.equal(store.hits, 1, 'a second POST could create the thing twice');
    assert.equal((await t.send('c1', `${store.url}?boom`)).status, 500);
    assert.equal(store.hits, 2, '500 is the store being wrong, not busy');
    assert.equal((await t.send('c1', store.url)).status, 404);
    assert.equal(store.hits, 3);
  } finally { await store.close(); }
});

test('retry: a POST that never reached the store (connection refused) is retried', async () => {
  const store = await fakeStore(reply(200));
  const url = store.url;
  await store.close(); // nothing listens on the port any more
  let calls = 0;
  const counting: typeof fetch = (...args) => { calls += 1; return fetch(...args); };
  const t = new Transport('salla', { maxAttempts: 3 }, counting, fakeClock());
  await assert.rejects(() => t.send('c1', url, { method: 'POST', body: '{}' }), (e: any) => code(e) === 'upstream_unavailable');
  assert.equal(calls, 3);
});

test('retry: a POST the store received before the connection dropped is not sent again', async () => {
  const store = await fakeStore((req) => { req.socket.destroy(); });
  try {
    const { t } = transport({ maxAttempts: 3 });
    await assert.rejects(() => t.send('c1', store.url, { method: 'POST', body: '{}' }), (e: any) => code(e) === 'upstream_unavailable');
    assert.equal(store.hits, 1, 'fetch reports this as the same TypeError as a refused connection');
  } finally { await store.close(); }
});

test('circuit: opens after repeated failures, fails fast, then one trial closes it', async () => {
  let healthy = false;
  const store = await fakeStore((req, res, hit) => reply(healthy ? 200 : 503)(req, res, hit));
  try {
    const { t, clock } = transport({ maxAttempts: 1, failureThreshold: 3, cooldownMs: 30_000 });
    for (let i = 0; i < 3; i++) assert.equal((await t.send('c1', store.url)).status, 503);
    assert.equal(t.circuitState('c1'), 'open');

    await assert.rejects(() => t.send('c1', store.url), (e: any) => code(e) === 'upstream_unavailable');
    assert.equal(store.hits, 3, 'an open circuit sends nothing');
    assert.equal((await t.send('c2', store.url)).status, 503, 'another connection has its own circuit');
    assert.equal(store.hits, 4);

    clock.advance(30_000);
    assert.equal(t.circuitState('c1'), 'half-open');
    assert.equal((await t.send('c1', store.url)).status, 503, 'the trial fails…');
    assert.equal(t.circuitState('c1'), 'open', '…and the cooldown starts again');

    clock.advance(30_000);
    healthy = true;
    assert.equal((await t.send('c1', store.url)).status, 200);
    assert.equal(t.circuitState('c1'), 'closed');
  } finally { await store.close(); }
});

test('circuit: half-open lets exactly one trial through', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let failing = true;
  const store = await fakeStore((req, res, hit) => {
    if (failing) return reply(503)(req, res, hit);
    void gate.then(() => reply(200)(req, res, hit));
  });
  try {
    const { t, clock } = transport({ maxAttempts: 1, failureThreshold: 1, cooldownMs: 1_000 });
    await t.send('c1', store.url);
    clock.advance(1_000);
    failing = false;
    const trial = t.send('c1', store.url);
    await assert.rejects(() => t.send('c1', store.url), (e: any) => code(e) === 'upstream_unavailable');
    release();
    assert.equal((await trial).status, 200);
    assert.equal(store.hits, 2);
  } finally { await store.close(); }
});

test('rate limit: per connection — one store waits for its bucket, another does not', async () => {
  const store = await fakeStore(reply(200));
  try {
    const { t, clock } = transport({ rate: { requests: 2, perMs: 1_000 }, maxQueueMs: 600 });
    await t.send('c1', store.url);
    await t.send('c1', store.url);
    assert.deepEqual(clock.sleeps, []);
    await t.send('c1', store.url);
    assert.deepEqual(clock.sleeps, [500], 'the third call waits one refill interval');
    await t.send('c2', store.url);
    assert.deepEqual(clock.sleeps, [500], 'c2 has its own full bucket');
    assert.equal(store.hits, 4);
  } finally { await store.close(); }
});

test('rate limit: a wait longer than maxQueueMs is refused before anything is sent', async () => {
  const store = await fakeStore(reply(200));
  try {
    const { t } = transport({ rate: { requests: 1, perMs: 10_000 }, maxQueueMs: 1_000 });
    await t.send('c1', store.url);
    await assert.rejects(() => t.send('c1', store.url), (e: any) => code(e) === 'rate_limited' && e.retryAfter === 10);
    assert.equal(store.hits, 1);
  } finally { await store.close(); }
});
