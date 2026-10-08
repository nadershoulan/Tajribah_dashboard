// P7 load test 2 of 5 — event ingest, in Node (the same load as `ingest.js`, with nothing to install).
//
//   node load/ingest.mjs --base https://staging.tajribah.org --rate 3000 --seconds 600 --stores 200
//
// Sends what the widget sends (`widget/src/events.ts`): `text/plain` JSON batches of 20 events with a
// fresh session token, to stores load-001 … load-NNN (seeded by `seed-stores.sql`, staging only), at a
// constant rate. Prints the collector's answer times and status counts each 10 seconds and at the end.
//
// The collector answers 204 to every batch, kept or dropped (a bot learns nothing), so the answer
// cannot prove "zero loss". That is checked after the run against the database, with the line this
// script prints: events stored for the load stores since the start = batches answered 2xx × 20.
//
// Pass marks (plan §8): answer p99 < 100 ms, no failed request, zero loss, the roll-up within 30 s.
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const BASE = arg('base', 'https://staging.tajribah.org');
const PATH = arg('path', '/api/analytics/collect');
const EVENTS_PER_SECOND = Number(arg('rate', '300'));
const SECONDS = Number(arg('seconds', '60'));
const STORES = Number(arg('stores', '200'));
const BATCH = 20;
const TYPES = ['product_view', 'product_view', 'product_view', 'ar_open', 'ar_place', 'tryon_start', 'add_to_cart'];
// A browser's user agent: the collector drops robots (`node-fetch`, `curl/` …) without a word.
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

if (!/^https:\/\/(staging\.tajribah\.org|localhost|127\.0\.0\.1)/.test(BASE) && !process.argv.includes('--yes-not-staging')) {
  console.error(`refusing ${BASE}: load runs go to staging (pass --yes-not-staging to override)`);
  process.exit(2);
}

const stores = Array.from({ length: STORES }, (_, i) => `load-${String(i + 1).padStart(3, '0')}`);
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const token = () => { let s = 'load'; for (let i = 0; i < 28; i++) s += chars[Math.floor(Math.random() * chars.length)]; return s; };

const batchesPerSecond = EVENTS_PER_SECOND / BATCH;
const total = Math.round(batchesPerSecond * SECONDS);
const startedAt = new Date();
const times = [];
let window = [];
const statuses = new Map();
let failed = 0, inFlight = 0, sent = 0, ok = 0;

async function one(i) {
  const store = stores[i % stores.length];
  const events = Array.from({ length: BATCH }, (_, k) => ({ type: TYPES[Math.floor(Math.random() * TYPES.length)], t: k * 50, productId: `load-${1 + (k % 3)}` }));
  const body = JSON.stringify({ v: 1, store, session: token(), sdk: 'load-node', sentAt: Date.now(), events });
  const t0 = performance.now();
  inFlight++;
  try {
    const res = await fetch(`${BASE}${PATH}`, { method: 'POST', body, headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': UA, origin: 'https://load.tajribah.test' } });
    await res.arrayBuffer();
    const ms = performance.now() - t0;
    times.push(ms); window.push(ms);
    statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
    if (res.ok) ok++; else failed++;
  } catch { failed++; statuses.set('network', (statuses.get('network') ?? 0) + 1); }
  finally { inFlight--; }
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const line = (arr) => `p50 ${pct(arr, 50).toFixed(0)} ms · p95 ${pct(arr, 95).toFixed(0)} ms · p99 ${pct(arr, 99).toFixed(0)} ms`;

console.log(`ingest load → ${BASE}${PATH}: ${EVENTS_PER_SECOND} events/s (${batchesPerSecond} batches/s) for ${SECONDS} s over ${STORES} stores; started ${startedAt.toISOString()}`);
const ticker = setInterval(() => {
  console.log(`  ${((Date.now() - startedAt) / 1000).toFixed(0)} s: sent ${sent}, ok ${ok}, failed ${failed}, in flight ${inFlight} — last 10 s ${line(window)}`);
  window = [];
}, 10_000);

// Constant arrival rate: each batch has its own start time, whatever the earlier ones are doing.
const pending = [];
for (let i = 0; i < total; i++) {
  const due = startedAt.getTime() + (i * 1000) / batchesPerSecond;
  const wait = due - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  sent++;
  pending.push(one(i));
}
await Promise.all(pending);
clearInterval(ticker);

const p99 = pct(times, 99);
const pass = p99 < 100 && failed === 0;
console.log(`\ndone: ${sent} batches (${sent * BATCH} events), ${ok} answered 2xx, ${failed} failed; statuses ${JSON.stringify(Object.fromEntries(statuses))}`);
console.log(`answer times: ${line(times)} — ${pass ? 'PASS' : 'FAIL'} (p99 < 100 ms, none failed)`);
console.log(`zero-loss check (staging database), expect ${ok * BATCH}:`);
console.log(`  select count(*) from analytics_events e join tenants t on t.id = e.tenant_id where t.slug like 'load-%' and e.occurred_at >= '${startedAt.toISOString()}';`);
process.exit(pass ? 0 : 99);
