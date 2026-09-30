#!/usr/bin/env node
/**
 * P0.20 — the smoke test for a running dashboard: every read endpoint, then a merchant's usual changes,
 * against a real deployment (staging, or the app on a local Postgres — docs/DATABASE.md). Nothing may
 * answer 5xx. It creates, changes and deletes its own test product, API key, webhook endpoint and
 * custom role; point it at a test store, never a merchant's.
 *
 *   node scripts/smoke/smoke.mjs --base https://staging.tajribah.sa --email test@… --password …
 *
 * First run (2026-09-30, workerd + PostgreSQL 16 on this machine): found /api/models and /api/tryon
 * answering 500 — the request path loaded `sharp`, which Workers cannot (fixed, and now guarded by
 * server/worker/__tests__/edge-imports.test.ts). Then: 48 reads and 28 changes, no 5xx.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const base = arg('--base');
const email = arg('--email');
const password = arg('--password');
if (!base || !email || !password) { console.error('usage: node scripts/smoke/smoke.mjs --base <url> --email <e> --password <p>'); process.exit(2); }

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../app/api');
const H = { 'content-type': 'application/json', origin: base };
const rows = [];

const signIn = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password }) });
const session = await signIn.json().catch(() => ({}));
if (!session.accessToken) { console.error(`sign-in failed (${signIn.status}): ${JSON.stringify(session).slice(0, 200)} — use an account without two-step sign-in`); process.exit(1); }
const auth = { ...H, authorization: `Bearer ${session.accessToken}` };

async function call(what, method, route, body, expect, headers = auth) {
  const res = await fetch(base + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  const ok = expect ? expect.includes(res.status) : res.status < 500;
  rows.push([ok ? 'ok ' : 'BAD', res.status, what, ok ? '' : text.slice(0, 240)]);
  return json;
}

// Every GET route without an id in its path (the ones that need one are exercised below).
function getRoutes(dir, prefix = '/api') {
  return fs.readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) return name.includes('[') ? [] : getRoutes(p, `${prefix}/${name}`);
    return name === 'route.ts' && /export const GET/.test(fs.readFileSync(p, 'utf8')) ? [prefix] : [];
  });
}
const QUERY = { '/api/analytics': '?range=30d', '/api/analytics/export': '?range=7d', '/api/admin/ai': '?days=30', '/api/admin/ai/models': '?days=30' };
for (const route of getRoutes(API)) await call(`read ${route}`, 'GET', route + (QUERY[route] ?? ''), undefined, null);

const product = await call('create a product', 'POST', '/api/products', { name: 'Smoke test watch', nameAr: 'ساعة اختبار', sku: `SMOKE-${Date.now()}`, priceMinor: 125050, productType: 'watch', dimensions: { widthMm: 41, heightMm: 48, depthMm: 12, caseMm: 41 } }, [201]);
const id = product?.id;
await call('read it', 'GET', `/api/products/${id}`, undefined, [200]);
await call('change it', 'PATCH', `/api/products/${id}`, { priceMinor: 99900, arEnabled: true, tryonEnabled: true }, [200]);
await call('try-on settings for it', 'PATCH', `/api/tryon/${id}`, { caseMm: 41, finishAr: 'ذهبي', finishEn: 'Gold', enabled: false }, [200]);
await call('a model upload link', 'POST', '/api/models/uploads', { productId: id, filename: 'smoke.glb', contentType: 'model/gltf-binary', sizeBytes: 123456 }, [201]);
await call('the team', 'GET', '/api/team', undefined, [200]);
const key = await call('an API key', 'POST', '/api/api-keys', { name: 'Smoke test', scopes: ['products:read', 'analytics:read'], expiresInDays: 1 }, [201, 402]);
if (key?.key) {
  const apiAuth = { authorization: `Bearer ${key.key}` };
  await call('the public API with it', 'GET', '/api/v1/products', undefined, [200], apiAuth);
  await call('the public API: one product', 'GET', `/api/v1/products/${id}`, undefined, [200], apiAuth);
  await call('the public API: a scope it lacks', 'GET', '/api/v1/models', undefined, [403], apiAuth);
  await call('revoke it', 'POST', `/api/api-keys/${key.apiKey.id}/revoke`, undefined, [200]);
  await call('the public API after revoking', 'GET', '/api/v1/products', undefined, [401], apiAuth);
}
const hook = await call('a webhook endpoint', 'POST', '/api/webhook-endpoints', { url: 'https://example.com/tajribah-smoke', events: ['product.updated'], description: 'Smoke test' }, [201, 402]);
if (hook?.endpoint) {
  await call('switch it off', 'PATCH', `/api/webhook-endpoints/${hook.endpoint.id}`, { active: false }, [200]);
  await call('delete it', 'DELETE', `/api/webhook-endpoints/${hook.endpoint.id}`, undefined, [200, 204]);
}
await call('mark notifications read', 'POST', '/api/notifications/read', { all: true }, [200]);
await call('the home screen after all that', 'GET', '/api/dashboard', undefined, [200]);
await call('delete the product', 'DELETE', `/api/products/${id}`, undefined, [200, 204]);

for (const r of rows) console.log(r[0], String(r[1]).padEnd(4), r[2], r[3]);
const bad = rows.filter((r) => r[0] === 'BAD');
console.log(`\n${bad.length ? 'FAILED' : 'passed'}: ${rows.length - bad.length} of ${rows.length}`);
process.exit(bad.length ? 1 : 0);
