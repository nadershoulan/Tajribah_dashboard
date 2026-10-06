/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T95 — a product whose feed gave its store page is published at that page's ref too, for a tag added once in
 * Google Tag Manager: both addresses written, kept true and taken down together; the config names the
 * product's own ref; a product without a page is published exactly as before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { edgeConfigs, products, tryonConfigs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { keyOf, serveConfig } from '@/server/core/edge/host';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { edgeStatuses, publishProduct, refreshStore, unpublishProduct } from '@/server/modules/edge/publish';
import { pageRefOf } from '@/widget/src/auto';
import { parseConfig } from '@/widget/src/config';
import { configUrl } from '@/widget/src/main';

setLogLevel('error');
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);
class CdnStorage extends MemoryStorage { publicUrl(k: string) { return `https://cdn.example.test/${k}`; } }

const SILVER = 'https://failet.sa/ar/%D8%B3%D8%A7%D8%B9%D8%A9-%D8%B1%D8%AC%D8%A7%D9%84%D9%8A%D8%A9-%D9%81%D8%B6%D9%8A-%D9%85%D9%8A%D9%86%D8%A7-%D8%B1%D9%85%D8%A7%D8%AF%D9%8A/p1412564664';
const PAGE_KEY = 'shop/page%3Ap1412564664.json';

async function setup(harness: TestDb) {
  setStorage(new CdnStorage());
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  const seeded = await seedTenant(harness, 'shop', { plan: 'pro' });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  return { ...seeded, ctx, kv };
}

/** A watch whose try-on is complete: publishable with no 3D model. */
async function watch(harness: TestDb, tenantId: string, over: Record<string, unknown> = {}) {
  const [row] = await admin(harness, () => harness.db.insert(products).values({
    tenantId, name: 'Silver watch', nameAr: 'ساعة رجالية فضي', productType: 'watch', externalId: '244167095', ...over,
  } as any).returning()) as any[];
  await admin(harness, () => harness.db.insert(tryonConfigs).values({
    id: uuidv7(), tenantId, productId: row.id, category: 'watch', wornKey: `t/${tenantId}/photo/${row.id}/worn.webp`, wornBytes: 100,
    flatKey: `t/${tenantId}/photo/${row.id}/flat.webp`, flatBytes: 100, caseTenthsMm: 420, enabled: true,
  } as any));
  return row;
}

const body = (kv: MemoryConfigStore, key: string) => kv.entries.get(key)?.body ?? null;
const rowOf = async (harness: TestDb, productId: string) => (await admin(harness, () => harness.db.select().from(edgeConfigs).where(eq(edgeConfigs.productId, productId))) as any[])[0];

test('a product with its store page: published at its page too, the same config, naming the product’s own ref', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness);
    const silver = await watch(harness, tenantId, { pageUrl: SILVER });
    await publishProduct(ctx, silver.id);
    assert.ok(body(kv, 'shop/244167095.json'), 'its own address, as before');
    assert.equal(body(kv, PAGE_KEY), body(kv, 'shop/244167095.json'), 'and its page’s, with the same config');
    assert.equal(keyOf(new URL(configUrl('https://cfg.tajribah.com/v1', 'shop', pageRefOf(SILVER)!)).pathname), PAGE_KEY, 'the address the widget asks for on that page');
    const served = await serveConfig(new Request(configUrl('https://cfg.tajribah.com/v1', 'shop', 'page:p1412564664')), kv);
    assert.equal(served.status, 200);
    assert.equal(parseConfig(await served.json())?.ref, '244167095', 'the widget reports and opens the try-on under the product’s own ref');
    assert.equal((await rowOf(harness, silver.id)).pageKey, PAGE_KEY);

    // a product without a page: no second address, and its config has no ref at all (unchanged for every other product)
    const plain = await watch(harness, tenantId, { externalId: '24517040', name: 'Plain' });
    await publishProduct(ctx, plain.id);
    assert.equal(JSON.parse(body(kv, 'shop/24517040.json')!).ref, undefined);
    assert.equal((await rowOf(harness, plain.id)).pageKey, null);
    assert.equal([...kv.entries.keys()].filter((k) => k.includes('page%3A')).length, 1);
  } finally { await harness.close(); }
});

test('the page address follows the product: its page moves, it is withdrawn and back, it is removed', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness);
    const silver = await watch(harness, tenantId);
    await publishProduct(ctx, silver.id);
    assert.equal((await rowOf(harness, silver.id)).pageKey, null, 'published before its page was known');

    // the feed's next read gives its page: the screen says shoppers see an older one, the refresh writes the page address
    await admin(harness, () => harness.db.update(products).set({ pageUrl: SILVER } as any).where(eq(products.id, silver.id)));
    assert.equal((await edgeStatuses(ctx, [silver.id])).get(silver.id)?.outdated, true);
    assert.deepEqual([...(await refreshStore(tenantId, silver.id, 'r'))], [[silver.id, 'rewritten']]);
    assert.ok(body(kv, PAGE_KEY));
    assert.equal((await edgeStatuses(ctx, [silver.id])).get(silver.id)?.outdated, false);
    assert.deepEqual([...(await refreshStore(tenantId, silver.id, 'r'))], [[silver.id, 'unchanged']], 'nothing changed: nothing written');

    // the page moves: the old address is deleted, the new one written
    await admin(harness, () => harness.db.update(products).set({ pageUrl: 'https://failet.sa/en/silver/p1412560000' } as any).where(eq(products.id, silver.id)));
    assert.equal((await edgeStatuses(ctx, [silver.id])).get(silver.id)?.outdated, true, 'the same config, at another page: still news for shoppers');
    await refreshStore(tenantId, silver.id, 'r');
    assert.equal(body(kv, PAGE_KEY), null);
    assert.ok(body(kv, 'shop/page%3Ap1412560000.json'));

    // withdrawn (try-on off): both leave; back on: both return
    await admin(harness, () => harness.db.update(tryonConfigs).set({ enabled: false } as any).where(eq(tryonConfigs.productId, silver.id)));
    assert.deepEqual([...(await refreshStore(tenantId, silver.id, 'r'))], [[silver.id, 'withdrawn']]);
    assert.deepEqual([body(kv, 'shop/244167095.json'), body(kv, 'shop/page%3Ap1412560000.json')], [null, null]);
    await admin(harness, () => harness.db.update(tryonConfigs).set({ enabled: true } as any).where(eq(tryonConfigs.productId, silver.id)));
    await refreshStore(tenantId, silver.id, 'r');
    assert.ok(body(kv, 'shop/244167095.json') && body(kv, 'shop/page%3Ap1412560000.json'));

    // removed by the merchant: both gone, and the row forgets the page address
    await unpublishProduct(ctx, silver.id);
    assert.deepEqual([body(kv, 'shop/244167095.json'), body(kv, 'shop/page%3Ap1412560000.json')], [null, null]);
    assert.equal((await rowOf(harness, silver.id)).pageKey, null);
  } finally { await harness.close(); }
});

test('the same page imported twice: removing one leaves the other’s button on that page', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness);
    const fromFeed = await watch(harness, tenantId, { pageUrl: SILVER });
    const fromFile = await watch(harness, tenantId, { pageUrl: `${SILVER}?ref=file`, externalId: 'file-244167095', connectionId: uuidv7() });
    await publishProduct(ctx, fromFeed.id);
    await publishProduct(ctx, fromFile.id);
    await unpublishProduct(ctx, fromFeed.id);
    assert.ok(body(kv, PAGE_KEY), 'the other copy is still live there');
    await unpublishProduct(ctx, fromFile.id);
    assert.equal(body(kv, PAGE_KEY), null, 'the last one out takes it down');
  } finally { await harness.close(); }
});
