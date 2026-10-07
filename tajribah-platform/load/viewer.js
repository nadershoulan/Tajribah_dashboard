// P7 load test 1 of 5 — the viewer path (plan §8): 5,000 requests a second against the edge
// config and the CDN, for 10 minutes. What a shop's product page costs us, at launch-day scale.
//
//   k6 run load/viewer.js -e CFG_BASE=https://cfg.tajribah.org -e TARGETS=store/ref,store/ref2
//
// Each iteration is one shopper opening a product page: the widget reads the product's config
// (`/v1/{store}/{ref}.json`); if it names a model, the viewer starts downloading it. The
// thresholds are the plan's SLOs: config p95 < 50 ms, model download start (time to first byte)
// p95 < 200 ms, and effectively no failures.
import http from 'k6/http';
import { check } from 'k6';

const CFG_BASE = __ENV.CFG_BASE || 'https://cfg.tajribah.org';
const TARGETS = (__ENV.TARGETS || '').split(',').map((s) => s.trim()).filter(Boolean);
const RATE = Number(__ENV.RATE || 5000);
const DURATION = __ENV.DURATION || '10m';
const CHECK_MODELS = (__ENV.CHECK_MODELS || 'true') !== 'false';

if (!TARGETS.length) throw new Error('TARGETS: comma-separated store/product-ref pairs with a published config');

export const options = {
  scenarios: {
    shoppers: {
      executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: DURATION,
      preAllocatedVUs: Math.max(10, Math.ceil(RATE / 10)), maxVUs: Math.max(50, RATE * 2),
    },
  },
  thresholds: {
    'http_req_duration{kind:config}': ['p(95)<50'],
    'http_req_waiting{kind:model}': ['p(95)<200'],
    'http_req_failed': ['rate<0.001'],
    'checks': ['rate>0.999'],
  },
};

export default function shopper() {
  const target = TARGETS[Math.floor(Math.random() * TARGETS.length)];
  const [store, ref] = target.split('/');
  const res = http.get(`${CFG_BASE}/v1/${encodeURIComponent(store)}/${encodeURIComponent(ref)}.json`, { tags: { kind: 'config' } });
  const ok = check(res, {
    'config 200': (r) => r.status === 200,
    'config is public and cacheable': (r) => /public/.test(r.headers['Cache-Control'] || '') && r.headers['Access-Control-Allow-Origin'] === '*',
  });
  if (!ok || !CHECK_MODELS) return;
  const model = res.json('model');
  if (!model || !model.glb) return; // a try-on-only watch: no model to fetch
  // The start of the download is what the shopper waits on; the first bytes are enough to time it.
  const glb = http.get(model.glb, { headers: { Range: 'bytes=0-65535' }, tags: { kind: 'model' } });
  check(glb, { 'model starts': (r) => r.status === 200 || r.status === 206 });
}
