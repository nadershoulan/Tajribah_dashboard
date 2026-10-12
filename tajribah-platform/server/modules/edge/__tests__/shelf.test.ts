/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T140.1 — the store's try-on shelf: every live try-on product of the store (newest first), kept next to the configs
 * at `shelf:tryons` and rebuilt on publish and removal; a product with no try-on is not on it; read through the config
 * host like any config.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { products, tryonConfigs, modelFiles, models3d, modelVersions } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { MemoryConfigStore, configKey, setConfigStore } from '@/server/core/edge/configs';
import { keyOf } from '@/server/core/edge/host';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { publishProduct, refreshStore, unpublishProduct } from '@/server/modules/edge/publish';
import { SHELF_REF, refOfKey, shelfEntryOf } from '@/server/modules/edge/shelf';

setLogLevel('error');
class CdnStorage extends MemoryStorage { publicUrl(k: string) { return `https://cdn.example.test/${k}`; } }

async function setup(harness: TestDb) {
  setStorage(new CdnStorage());
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  const seeded = await seedTenant(harness, 'gold', { plan: 'pro' });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'req-gold' });
  return { ...seeded, ctx, kv };
}
async function watch(harness: TestDb, tenantId: string, ref: string, name: string, caseTenths: number, pageUrl: string | null) {
  const row = ((await harness.asAdmin(() => harness.db.insert(products).values({ tenantId, name, nameAr: `${name} ع`, productType: 'watch', externalId: ref, pageUrl } as any).returning())) as any[])[0];
  await harness.asAdmin(() => harness.db.insert(tryonConfigs).values({
    id: uuidv7(), tenantId, productId: row.id, category: 'watch',
    wornKey: `t/${tenantId}/photo/${row.id}/worn.webp`, wornBytes: 100, flatKey: `t/${tenantId}/photo/${row.id}/flat.webp`, flatBytes: 100,
    caseTenthsMm: caseTenths, enabled: true,
  } as any));
  return row;
}
async function lampOnly(harness: TestDb, tenantId: string) {
  const row = ((await harness.asAdmin(() => harness.db.insert(products).values({ tenantId, name: 'Lamp', productType: 'other', externalId: 'lamp-1', arEnabled: true, dimensions: { widthMm: 300, heightMm: 900 } } as any).returning())) as any[])[0];
  const modelId = uuidv7(), versionId = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(models3d).values({ id: modelId, tenantId, productId: row.id, name: 'Lamp', source: 'uploaded', status: 'ready', currentVersionId: versionId } as any);
    await harness.db.insert(modelVersions).values({ id: versionId, tenantId, modelId, version: 1, status: 'ready' } as any);
    await harness.db.insert(modelFiles).values({ id: uuidv7(), tenantId, modelVersionId: versionId, format: 'glb', variant: 'optimized', compression: 'meshopt', storageKey: `t/${tenantId}/model/${modelId}/v1/optimized.glb` } as any);
  });
  return row;
}
const shelf = (kv: MemoryConfigStore) => { const b = kv.entries.get(configKey('gold', SHELF_REF))?.body; return b === undefined ? null : JSON.parse(b); };

test('every live try-on of the store, newest first, with its pictures, real size and store page; rebuilt on removal', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness);
    const a = await watch(harness, tenantId, 'w-38', 'Oyster 38', 380, 'https://gold.sa/p/38');
    const b = await watch(harness, tenantId, 'w-42', 'Diver 42', 420, 'http://gold.sa/p/42');
    const lamp = await lampOnly(harness, tenantId);
    await publishProduct(ctx, a.id);
    await publishProduct(ctx, lamp.id);
    await publishProduct(ctx, b.id);
    const s = shelf(kv);
    assert.equal(s.v, 1);
    assert.deepEqual(s.products.map((p: any) => [p.ref, p.caseMm, p.category]), [['w-42', 42, 'watch'], ['w-38', 38, 'watch']], 'newest first; the 3D-only lamp is not on it');
    assert.deepEqual(s.products[1], {
      ref: 'w-38', name: 'Oyster 38', nameAr: 'Oyster 38 ع', category: 'watch', caseMm: 38,
      worn: `https://cdn.example.test/t/${tenantId}/photo/${a.id}/worn.webp`, flat: `https://cdn.example.test/t/${tenantId}/photo/${a.id}/flat.webp`, page: 'https://gold.sa/p/38',
    });
    assert.equal(s.products[0].page, null, 'only an https store page');
    assert.equal(keyOf(`/v1/gold/${encodeURIComponent(SHELF_REF)}.json`), configKey('gold', SHELF_REF), 'read through the config host like any config');
    kv.entries.delete(configKey('gold', SHELF_REF)); // a store published before the shelf existed
    await refreshStore(tenantId, null, 'req-sweep');
    assert.equal(shelf(kv).products.length, 2, 'the whole store’s refresh writes it');
    await unpublishProduct(ctx, b.id);
    assert.deepEqual(shelf(kv).products.map((p: any) => p.ref), ['w-38'], 'taken off the shop: off the shelf');
    await unpublishProduct(ctx, a.id);
    assert.equal(shelf(kv), null, 'no try-on left: no shelf');
  } finally { await harness.close(); }
});

test('a shelf entry: only from a config with a try-on; the ref from its key', () => {
  assert.equal(shelfEntryOf({ product: { name: 'Lamp' }, model: {} }, 'x', null), null);
  assert.equal(shelfEntryOf({ product: { name: 'Ring' }, tryon: { worn: 'https://a/w', flat: 'https://a/f', caseMm: 18, category: 'ring' } }, 'r1', 'https://s/r1')!.category, 'ring');
  assert.equal(refOfKey('gold/page%3Ap123.json'), 'page:p123');
  assert.equal(refOfKey('nonsense'), null);
});
