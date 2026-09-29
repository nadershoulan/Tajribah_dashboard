// P7 load test 2 of 5 — event ingest (plan §8): 3,000 events a second, zero loss, the rollup
// behind by less than 30 seconds.
//
//   k6 run load/ingest.js -e EV_BASE=https://ev.tajribah.com -e STORES=store1,store2,...
//
// Batches are what the widget sends (`widget/src/events.ts`: `text/plain` JSON, up to 20 events,
// a 16–64 character session token). The collector limits each store (per daily-salted address) to
// 60 batches a minute, so a run spreads over many test stores: at 20 events a batch, 3,000 events
// a second is 150 batches a second, which needs at least 150 stores — or a staging collector with
// that limit raised for the run. The threshold here is the collector's answer (p99 < 100 ms,
// fire-and-forget) and zero refusals; "zero loss" and the rollup lag are checked after the run
// against the database (count of events stored for the run's sessions = batches accepted × 20).
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const EV_BASE = __ENV.EV_BASE || 'https://ev.tajribah.com';
const PATH = __ENV.EV_PATH || '/v1/e';
const STORES = (__ENV.STORES || '').split(',').map((s) => s.trim()).filter(Boolean);
const PRODUCTS = (__ENV.PRODUCTS || 'load-1,load-2,load-3').split(',');
const EVENTS_PER_SECOND = Number(__ENV.EVENTS_PER_SECOND || 3000);
const DURATION = __ENV.DURATION || '10m';
const BATCH = 20;
const TYPES = ['product_view', 'product_view', 'product_view', 'ar_open', 'ar_place', 'tryon_start', 'add_to_cart'];

if (!STORES.length) throw new Error('STORES: comma-separated test store keys');

export const accepted = new Counter('events_accepted');

export const options = {
  scenarios: {
    pages: {
      executor: 'constant-arrival-rate', rate: Math.ceil(EVENTS_PER_SECOND / BATCH), timeUnit: '1s', duration: DURATION,
      preAllocatedVUs: 50, maxVUs: 1000,
    },
  },
  thresholds: {
    'http_req_duration{kind:ingest}': ['p(99)<100'],
    'http_req_failed': ['rate==0'],
  },
};

const token = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'load';
  for (let i = 0; i < 28; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

export default function page() {
  const store = STORES[Math.floor(Math.random() * STORES.length)];
  const now = Date.now();
  const events = Array.from({ length: BATCH }, (_, i) => ({
    type: TYPES[Math.floor(Math.random() * TYPES.length)], t: i * 50,
    productId: PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)],
  }));
  const body = JSON.stringify({ v: 1, store, session: token(), sdk: 'k6-load', sentAt: now, events });
  const res = http.post(`${EV_BASE}${PATH}`, body, { headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, tags: { kind: 'ingest' } });
  if (check(res, { 'batch accepted': (r) => r.status >= 200 && r.status < 300 })) accepted.add(BATCH);
}
