// P7 load test 3 of 5 — the dashboard (plan §8): 500 merchants at once, navigating as merchants
// do. Thresholds are the plan's SLOs: a read p95 < 300 ms, a write p95 < 800 ms.
//
//   k6 run load/dashboard.js -e APP_BASE=https://staging.app.tajribah.sa -e ACCOUNTS=accounts.json
//
// `ACCOUNTS` is a JSON file of `[{ "email": "...", "password": "..." }]` — staging test merchants,
// one per virtual user (never real ones). Each signs in once (the sign-in limit is 10 per email
// in 15 minutes: one account per user keeps the test from measuring the limiter), then walks the
// screens a merchant opens most — home, products and a product, 3D models, analytics, the bell —
// and now and then changes a product (a write). Sign-in itself is excluded from the read budget.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const APP_BASE = __ENV.APP_BASE || 'https://staging.app.tajribah.sa';
const USERS = Number(__ENV.USERS || 500);
const DURATION = __ENV.DURATION || '15m';
const accounts = new SharedArray('accounts', () => JSON.parse(open(__ENV.ACCOUNTS || './accounts.json')));

export const options = {
  scenarios: {
    merchants: { executor: 'constant-vus', vus: USERS, duration: DURATION },
  },
  thresholds: {
    'http_req_duration{kind:read}': ['p(95)<300'],
    'http_req_duration{kind:write}': ['p(95)<800'],
    'http_req_failed{kind:read}': ['rate<0.001'],
    'checks': ['rate>0.99'],
  },
};

const json = (token) => ({ headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: APP_BASE } });
let session = null;

function signIn() {
  const account = accounts[(__VU - 1) % accounts.length];
  const res = http.post(`${APP_BASE}/api/auth/login`, JSON.stringify(account), { headers: { 'content-type': 'application/json', origin: APP_BASE }, tags: { kind: 'auth' } });
  check(res, { 'signed in': (r) => r.status === 200 && !!r.json('accessToken') });
  return res.status === 200 ? res.json('accessToken') : null;
}

const read = (path, token) => {
  const res = http.get(`${APP_BASE}${path}`, { ...json(token), tags: { kind: 'read', name: path.replace(/[0-9a-f-]{36}/g, ':id') } });
  check(res, { [`${path.split('?')[0].replace(/[0-9a-f-]{36}/g, ':id')} 200`]: (r) => r.status === 200 });
  return res;
};

export default function merchant() {
  if (!session) session = signIn();
  if (!session) { sleep(5); return; }
  read('/api/auth/me', session);
  read('/api/dashboard', session);
  sleep(1 + Math.random() * 2);
  const list = read('/api/products?limit=50', session);
  const rows = list.status === 200 ? list.json('rows') : [];
  if (rows && rows.length) {
    const product = rows[Math.floor(Math.random() * rows.length)];
    read(`/api/products/${product.id}`, session);
    if (Math.random() < 0.1) { // one visit in ten changes something
      const res = http.patch(`${APP_BASE}/api/products/${product.id}`, JSON.stringify({ name: product.name }), { ...json(session), tags: { kind: 'write' } });
      check(res, { 'product saved': (r) => r.status === 200 });
    }
  }
  sleep(1 + Math.random() * 2);
  read('/api/models', session);
  read('/api/analytics?range=30d', session);
  read('/api/notifications', session);
  sleep(2 + Math.random() * 3);
}
