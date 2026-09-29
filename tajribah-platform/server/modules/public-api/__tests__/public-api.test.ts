/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P8 — the Public API, v1: every answer is exactly its documented shape (strict schemas, the same
 * ones the OpenAPI document is built from); the document names every route served and nothing
 * else; a key reaches only its scopes and only its store; a dashboard session is not a key; each
 * key is limited, and the answer says how much is left.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DEMO_ANALYTICS, DEMO_MODELS, DEMO_PRODUCTS } from '@/lib/demo-data';
import { AnalyticsV1, ModelListV1, ModelV1, ProductPageV1, ProductV1, V1_RATE, V1_ROUTES } from '@/lib/public-api/v1';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryRateLimiter, setRateLimiter, type RateLimiter } from '@/server/core/ratelimit/limiter';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { signJwt } from '@/server/core/auth/crypto';
import { createTestDb, enablePlanFeature, seedTenant, type TestDb } from '@/server/testing/harness';
import { createApiKey } from '@/server/modules/api-keys/service';
import { createProduct } from '@/server/modules/products/service';
import * as v1 from '@/server/modules/public-api/http';
import { analyticsV1, modelV1, productV1 } from '@/server/modules/public-api/v1';

setLogLevel('error');
const APP = 'http://localhost:5173';
const SECRET = 's'.repeat(40);

test('the dashboard\'s rows map to exactly the documented v1 shapes', () => {
  for (const row of DEMO_PRODUCTS) ProductV1.parse(productV1(row));
  for (const row of DEMO_MODELS.filter((m) => m.status !== 'archived')) ModelV1.parse(modelV1(row));
  AnalyticsV1.parse(analyticsV1(DEMO_ANALYTICS));
  // A field added to a dashboard row does not reach v1 by accident.
  assert.throws(() => ProductV1.parse({ ...productV1(DEMO_PRODUCTS[0]!), views30: 1 }));
});

test('the reference names every v1 route served, and only those; every reference inside it resolves', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: SECRET, ENCRYPTION_KEY: 'e'.repeat(40) });
  const response = await v1.v1OpenApiHandler(new Request(`${APP}/api/v1/openapi.json`));
  assert.equal(response.status, 200, 'public: no key');
  assert.match(response.headers.get('cache-control') ?? '', /public/);
  const doc = await response.json() as any;
  assert.equal(doc.openapi, '3.1.0');
  assert.deepEqual(doc.servers, [{ url: APP }]);

  const served: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'route.ts') served.push('/' + relative(join(process.cwd(), 'app'), dir).split(sep).join('/').replace(/\[(\w+)\]/g, '{$1}'));
    }
  };
  walk(join(process.cwd(), 'app', 'api', 'v1'));
  assert.deepEqual(served.filter((p) => p !== '/api/v1/openapi.json').sort(), Object.keys(doc.paths).sort());
  assert.deepEqual(Object.keys(doc.paths).sort(), [...new Set(V1_ROUTES.map((r) => r[1]))].sort());

  const refs = JSON.stringify(doc).match(/#\/components\/schemas\/\w+/g) ?? [];
  for (const ref of refs) assert.ok(doc.components.schemas[ref.split('/').pop()!], ref);
  assert.equal(doc.components.schemas.Product.additionalProperties, false, 'strict in the document too');
  resetEnv();
});

async function world(harness: TestDb) {
  const seeded = await seedTenant(harness, 'alpha');
  await enablePlanFeature(harness, 'starter', 'public_api');
  await enablePlanFeature(harness, 'starter', 'full_analytics');
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const made = [];
  for (const name of ['Oyster 41', 'Emerald ring', 'Pearl drops']) made.push(await createProduct(ctx, { name, status: 'active' }));
  const { key } = await createApiKey(ctx, { name: 'ERP', scopes: ['products:read', 'analytics:read'], expiresInDays: null }, { authSecret: SECRET });
  return { ...seeded, ctx, made, key };
}
const get = (handler: (r: Request) => Promise<Response>, path: string, key?: string) =>
  handler(new Request(`${APP}${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }));

test('with a key: its store\'s data, in the documented shapes, within its scopes — and the limit it has left', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: SECRET, ENCRYPTION_KEY: 'e'.repeat(40) });
  setRateLimiter(new MemoryRateLimiter());
  const harness = await createTestDb();
  try {
    const a = await world(harness);
    const other = await seedTenant(harness, 'bravo');
    const otherCtx = await buildTenantContext({ actor: { userId: other.userId, email: other.email, isStaff: false }, tenantId: other.tenantId, requestId: 'r2' });
    const foreign = await createProduct(otherCtx, { name: 'Not yours', status: 'active' });

    const list = await get(v1.v1ListProductsHandler, '/api/v1/products?limit=2', a.key);
    assert.equal(list.status, 200);
    assert.equal(list.headers.get('x-ratelimit-limit'), String(V1_RATE.limit));
    assert.equal(list.headers.get('x-ratelimit-remaining'), String(V1_RATE.limit - 1));
    const page = ProductPageV1.parse(await list.json());
    assert.equal(page.data.length, 2);
    assert.ok(page.nextCursor);
    const rest = ProductPageV1.parse(await (await get(v1.v1ListProductsHandler, `/api/v1/products?limit=2&cursor=${page.nextCursor}`, a.key)).json());
    assert.deepEqual([...page.data, ...rest.data].map((p) => p.name).sort(), ['Emerald ring', 'Oyster 41', 'Pearl drops'], 'every product once, only this store\'s');
    assert.equal(rest.nextCursor, null);

    const one = await get(v1.v1ProductHandler, `/api/v1/products/${a.made[0]!.id}`, a.key);
    assert.equal(ProductV1.parse(await one.json()).name, 'Oyster 41');
    assert.equal((await get(v1.v1ProductHandler, `/api/v1/products/${foreign.id}`, a.key)).status, 404, 'another store\'s product does not exist');
    assert.equal((await get(v1.v1ProductHandler, '/api/v1/products/not-an-id', a.key)).status, 404);
    assert.equal((await get(v1.v1ListProductsHandler, '/api/v1/products?limit=999', a.key)).status, 422);

    AnalyticsV1.parse(await (await get(v1.v1AnalyticsHandler, '/api/v1/analytics?range=7d', a.key)).json());
    const models = await get(v1.v1ModelsHandler, '/api/v1/models', a.key);
    assert.equal(models.status, 403, 'models:read is not among this key\'s scopes');
    assert.match(models.headers.get('content-type') ?? '', /problem\+json/);

    const modelKey = (await createApiKey(a.ctx, { name: 'Viewer', scopes: ['models:read'], expiresInDays: null }, { authSecret: SECRET })).key;
    ModelListV1.parse(await (await get(v1.v1ModelsHandler, '/api/v1/models', modelKey)).json());
  } finally { await harness.close(); setRateLimiter(new MemoryRateLimiter()); resetEnv(); }
});

test('no key, a wrong key or a dashboard session: 401; over the limit: 429 with how long to wait', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: SECRET, ENCRYPTION_KEY: 'e'.repeat(40) });
  const harness = await createTestDb();
  try {
    const a = await world(harness);
    assert.equal((await get(v1.v1ListProductsHandler, '/api/v1/products')).status, 401);
    assert.equal((await get(v1.v1ListProductsHandler, '/api/v1/products', 'tjr_not-a-real-key')).status, 401);
    const session = await signJwt({ sub: a.userId, sid: 'sid', tid: a.tenantId } as any, SECRET, 900);
    assert.equal((await get(v1.v1ListProductsHandler, '/api/v1/products', session)).status, 401, 'a dashboard session is not a key');

    const asked: string[] = [];
    const full: RateLimiter = { async hit(key) { asked.push(key); return { allowed: false, remaining: 0, retryAfter: 37 }; }, async reset() {} };
    setRateLimiter(full);
    const limited = await get(v1.v1ListProductsHandler, '/api/v1/products', a.key);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '37');
    assert.deepEqual(asked, [`public-api:${a.key.slice(0, 12)}`], 'counted per key');
  } finally { await harness.close(); setRateLimiter(new MemoryRateLimiter()); resetEnv(); }
});
