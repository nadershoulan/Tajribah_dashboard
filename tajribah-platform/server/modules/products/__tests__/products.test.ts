/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditLogs, dailyProductStats, edgeConfigs, models3d, products, storeConnections, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { riyadhDay } from '@/lib/format';
import { planByCode } from '@/lib/plans';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { configureNotify } from '@/server/core/notify/notify';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { createProduct, deleteProduct, getProduct, listProducts, updateProduct } from '@/server/modules/products/service';
import { assertRoomToShow } from '@/server/core/billing/entitlements';
import { registerHandler } from '@/server/modules/auth/http';
import { getProductHandler, listProductsHandler, updateProductHandler } from '@/server/modules/products/http';

setLogLevel('error');

async function store(harness: TestDb, name: string, role: 'owner' | 'editor' | 'viewer' = 'owner') {
  const seeded = await seedTenant(harness, name);
  let userId = seeded.userId;
  if (role !== 'owner') {
    userId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: userId, email: `${role}-${name}@example.test`, passwordHash: 'x', fullName: role } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: seeded.tenantId, userId, role, status: 'active' } as any);
    });
  }
  const ctx = await buildTenantContext({ actor: { userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

const plant = (harness: TestDb, table: any, rows: any): Promise<any[]> => harness.asAdmin(() => harness.db.insert(table).values(rows).returning() as Promise<any[]>);
const LIST = { filter: 'all' as const, limit: 50 };
const code = (e: any) => e.code;

test('create, read back, and every change lands in the audit trail', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const made = await createProduct(ctx, { name: 'Oyster 41', nameAr: 'أويستر 41', sku: 'OY-41', priceMinor: 289000, productType: 'watch', dimensions: { widthMm: 41, heightMm: 48 } });
    assert.equal(made.name, 'Oyster 41');
    assert.equal(made.modelStatus, 'none');
    assert.equal(made.views30, 0);
    await updateProduct(ctx, made.id, { arEnabled: true });
    await deleteProduct(ctx, made.id);
    const trail = (await harness.asAdmin(() => harness.db.select().from(auditLogs))).filter((r) => r.resourceType === 'product');
    assert.deepEqual(trail.map((r) => r.action), ['create', 'update', 'delete']);
  } finally { await harness.close(); }
});

test('AR cannot be switched on without width and height in millimetres', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const p = await createProduct(ctx, { name: 'No size yet' });
    await assert.rejects(() => updateProduct(ctx, p.id, { arEnabled: true }), (e: any) => code(e) === 'validation_failed' && 'arEnabled' in e.errors);
    await assert.rejects(() => updateProduct(ctx, p.id, { arEnabled: true, dimensions: { widthMm: 40 } }), (e: any) => 'arEnabled' in e.errors);
    await assert.rejects(() => updateProduct(ctx, p.id, { dimensions: { widthMm: 4100 } }), (e: any) => code(e) === 'validation_failed', 'over 3 m is a unit mistake');
    await assert.rejects(() => updateProduct(ctx, p.id, { dimensions: { widthMm: 0 } }), (e: any) => code(e) === 'validation_failed');
    const on = await updateProduct(ctx, p.id, { arEnabled: true, dimensions: { widthMm: 40, heightMm: 47.5 } });
    assert.equal(on.arEnabled, true);
    await assert.rejects(() => updateProduct(ctx, p.id, { dimensions: null }), (e: any) => 'arEnabled' in e.errors, 'removing the size while AR is on is refused too');
  } finally { await harness.close(); }
});

test('a synced product keeps its store-owned fields; the rest is editable', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const [conn] = await plant(harness, storeConnections, { tenantId, provider: 'salla', externalStoreId: 's-1' });
    const [synced] = await plant(harness, products, { tenantId, connectionId: conn.id, externalId: 'x1', name: 'From Salla', priceMinor: 1000 });
    await assert.rejects(() => updateProduct(ctx, synced.id, { name: 'Renamed', priceMinor: 5 }), (e: any) => 'name' in e.errors && 'priceMinor' in e.errors);
    const ok = await updateProduct(ctx, synced.id, { dimensions: { widthMm: 30, heightMm: 30 }, productType: 'jewelry' });
    assert.equal(ok.productType, 'jewelry');
  } finally { await harness.close(); }
});

test('search, filters and their counts, and paging that neither skips nor repeats', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const rows = Array.from({ length: 25 }, (_, i) => ({
      tenantId, name: `Watch ${String(i).padStart(2, '0')}`, sku: `W-${i}`,
      dimensions: i % 2 ? { widthMm: 40, heightMm: 48 } : null, arEnabled: i % 2 === 1, status: i === 24 ? 'draft' : 'active',
    }));
    await plant(harness, products, rows);
    await plant(harness, products, [{ tenantId, name: 'خاتم زمرد', nameAr: 'خاتم زمرد', sku: 'J-100%' }]);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await listProducts(ctx, { ...LIST, limit: 10, cursor });
      seen.push(...result.rows.map((r) => r.id));
      cursor = result.nextCursor ?? undefined;
      if (!cursor) break;
    }
    assert.equal(seen.length, 26);
    assert.equal(new Set(seen).size, 26, 'no product appears twice across pages');

    // T73: numbered pages give the same rows as the cursor, in the same order; a page wins over a cursor.
    const numbered: string[] = [];
    for (let page = 1; page <= 3; page++) numbered.push(...(await listProducts(ctx, { ...LIST, limit: 10, page, cursor: seen[0] })).rows.map((r) => r.id));
    assert.deepEqual(numbered, seen);
    assert.equal((await listProducts(ctx, { ...LIST, limit: 10, page: 3 })).nextCursor, null, 'the last page');
    assert.equal((await listProducts(ctx, { ...LIST, limit: 10, page: 4 })).rows.length, 0, 'past the end: empty');

    const all = await listProducts(ctx, LIST);
    assert.deepEqual(all.counts, { all: 26, ar_on: 12, no_ar: 14, missing_sizes: 14, draft: 1 });
    assert.equal((await listProducts(ctx, { ...LIST, filter: 'ar_on' })).rows.length, 12);
    assert.equal((await listProducts(ctx, { ...LIST, q: 'زمرد' })).rows.length, 1, 'Arabic search');
    assert.equal((await listProducts(ctx, { ...LIST, q: 'w-1' })).rows.length, 11, 'SKU search, case-insensitive (W-1, W-10…W-19)');
    assert.equal((await listProducts(ctx, { ...LIST, q: '100%' })).rows.length, 1, '% is a character, not a wildcard');
    assert.equal((await listProducts(ctx, { ...LIST, q: '%' })).rows.length, 1);
  } finally { await harness.close(); }
});

test('model status and 30-day numbers come from the real rows', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const [model] = await plant(harness, models3d, { tenantId, name: 'm', source: 'uploaded', status: 'ready' });
    const [p] = await plant(harness, products, { tenantId, name: 'With model', primaryModelId: model.id });
    const day = (ago: number) => riyadhDay(Date.now() - ago * 24 * 3600_000);
    await plant(harness, dailyProductStats, [
      { tenantId, productId: p.id, day: day(0), views: 10, arSessions: 3 },
      { tenantId, productId: p.id, day: day(29), views: 5, arSessions: 1 },
      { tenantId, productId: p.id, day: day(31), views: 1000, arSessions: 1000 },
    ]);
    const row = await getProduct(ctx, p.id);
    assert.equal(row.modelStatus, 'ready');
    assert.equal(row.views30, 15, 'the last 30 days in Riyadh, not older');
    assert.equal(row.arSessions30, 4);
    assert.equal(row.live, false, 'T42: not published');

    // T42: live = published and not withdrawn; a withdrawn or removed product is not live.
    const [q] = await plant(harness, products, { tenantId, name: 'Taken down' });
    const [r] = await plant(harness, products, { tenantId, name: 'Removed' });
    await plant(harness, edgeConfigs, [
      { tenantId, productId: p.id, key: 'alpha/p.json', version: 1, publishedAt: new Date() },
      { tenantId, productId: q.id, key: 'alpha/q.json', version: 1, publishedAt: new Date(), withdrawnAt: new Date() },
      { tenantId, productId: r.id, key: null, version: 1, publishedAt: new Date(), withdrawnAt: new Date() },
    ]);
    assert.equal((await getProduct(ctx, p.id)).live, true);
    const list = await listProducts(ctx, LIST);
    assert.deepEqual(list.rows.map((x) => [x.name, x.live]).sort(), [['Removed', false], ['Taken down', false], ['With model', true]]);
  } finally { await harness.close(); }
});

test('T72: the plan counts products shown in 3D — adding is never refused; switching 3D on past the limit is', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const limit = planByCode('starter').limits.products;
    const sized = { widthMm: 100, heightMm: 200 };
    await plant(harness, products, Array.from({ length: limit }, (_, i) => ({ tenantId, name: `p${i}`, arEnabled: true, dimensions: sized })));
    const more = await createProduct(ctx, { name: 'one more', dimensions: sized });
    assert.equal(more.name, 'one more', 'the catalogue is not limited');
    await assert.rejects(() => updateProduct(ctx, more.id, { arEnabled: true }), (e: any) => code(e) === 'quota_exceeded', 'showing one more in 3D is');
    const shown = (await listProducts(ctx, { ...LIST, filter: 'ar_on' })).rows[0]!;
    await updateProduct(ctx, shown.id, { arEnabled: false });
    await updateProduct(ctx, more.id, { arEnabled: true });
    assert.equal((await getProduct(ctx, shown.id)).arEnabled, false);
    // At the limit: switching the try-on on for a product already shown is fine; for a new one it is not.
    await assert.doesNotReject(() => assertRoomToShow(ctx, more.id), 'one already shown is not counted twice');
    await assert.rejects(() => assertRoomToShow(ctx, shown.id), (e: any) => code(e) === 'quota_exceeded');
  } finally { await harness.close(); }
});

test('deleting is soft and hidden; roles are enforced; another store gets 404', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const p = await createProduct(a.ctx, { name: 'Gone' });
    await deleteProduct(a.ctx, p.id);
    await assert.rejects(() => getProduct(a.ctx, p.id), (e: any) => code(e) === 'not_found');
    assert.equal((await listProducts(a.ctx, LIST)).counts.all, 0);
    const [row] = await harness.asAdmin(() => harness.db.select().from(products));
    assert.ok(row.deletedAt, 'the row is kept');
    // A later sync may set a deleted product's status back to active; deleted still wins.
    const [resurrected] = await plant(harness, products, { tenantId: a.tenantId, name: 'Deleted but active', status: 'active', deletedAt: new Date() });
    assert.equal((await listProducts(a.ctx, LIST)).counts.all, 0, 'a deleted product never lists, whatever its status');
    await assert.rejects(() => getProduct(a.ctx, resurrected.id), (e: any) => code(e) === 'not_found');

    const keep = await createProduct(a.ctx, { name: 'Keep' });
    // Each role gets its own store, acting as a non-owner member of it.
    const editor = await store(harness, 'alpha-ed', 'editor');
    const viewer = await store(harness, 'alpha-v', 'viewer');
    await assert.rejects(() => createProduct(viewer.ctx, { name: 'x' }), (e: any) => code(e) === 'forbidden');
    const mine = await createProduct(editor.ctx, { name: 'Editor product' });
    await assert.rejects(() => deleteProduct(editor.ctx, mine.id), (e: any) => code(e) === 'forbidden', 'editors cannot delete');

    const b = await store(harness, 'bravo');
    for (const attempt of [() => getProduct(b.ctx, keep.id), () => updateProduct(b.ctx, keep.id, { productType: 'bag' }), () => deleteProduct(b.ctx, keep.id)]) {
      await assert.rejects(attempt, (e: any) => code(e) === 'not_found');
    }
  } finally { await harness.close(); }
});

test('over HTTP: list and patch with a session; a malformed id is 404; a bad cursor is 422', async () => {
  resetEnv();
  loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  const harness = await createTestDb();
  const original = console.log;
  try {
    console.log = () => {};
    const signup = await registerHandler(new Request('http://localhost:5173/api/auth/register', {
      method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'o@example.test', password: 'a-long-enough-password', fullName: 'O', storeName: 'Oud' }),
    }));
    console.log = original;
    const { accessToken, tenant } = await signup.json() as any;
    const [p] = await plant(harness, products, { tenantId: tenant.id, name: 'Via API' });
    const auth = { authorization: `Bearer ${accessToken}`, origin: 'http://localhost:5173' };

    const list = await listProductsHandler(new Request('http://localhost:5173/api/products?filter=all', { headers: auth }));
    assert.equal(list.status, 200);
    assert.equal((await list.json() as any).rows[0].name, 'Via API');

    const patch = await updateProductHandler(new Request(`http://localhost:5173/api/products/${p.id}`, {
      method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ dimensions: { widthMm: 10, heightMm: 10 } }),
    }));
    assert.equal(patch.status, 200);

    assert.equal((await getProductHandler(new Request('http://localhost:5173/api/products/not-a-uuid', { headers: auth }))).status, 404);
    assert.equal((await listProductsHandler(new Request('http://localhost:5173/api/products?cursor=abc', { headers: auth }))).status, 422);
    assert.equal((await listProductsHandler(new Request('http://localhost:5173/api/products'))).status, 401);
  } finally { console.log = original; await harness.close(); resetEnv(); }
});
