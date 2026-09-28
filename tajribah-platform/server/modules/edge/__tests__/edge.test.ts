/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P1.15 — a product's viewer config, built from the database, checked with the widget's own parser,
 * published where shops read it, and kept true afterwards: rewritten, withdrawn, or back again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, edgeConfigs, jobs, modelFiles, models3d, modelVersions, products, tenantMemberships, tenants, tryonConfigs, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { MemoryConfigStore, configKey, setConfigStore } from '@/server/core/edge/configs';
import { keyOf, serveConfig } from '@/server/core/edge/host';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { listArConfigs, saveArConfig } from '@/server/modules/ar/service';
import { handleEdgeJob, isLive, refreshProduct, refreshStore, publishProduct } from '@/server/modules/edge/publish';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { updateSettings } from '@/server/modules/settings/service';
import { updateProduct } from '@/server/modules/products/service';
import { confirmCutout, startCutoutUpload, updateTryOn } from '@/server/modules/tryon/service';
import { handleDeleteLater } from '@/server/modules/tryon/retire';
import { forTenant } from '@/server/core/storage/storage';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '@/widget/src/config';
import { configUrl } from '@/widget/src/main';
import { tryOnProductFrom } from '../../../../../tajribah-try-on/lib/tryon-config';

setLogLevel('error');
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);
const code = (e: any) => e.code;

/** Storage whose public URLs are https, as the CDN's are — a memory:// URL is (rightly) refused. */
class CdnStorage extends MemoryStorage {
  publicUrl(k: string) { return `https://cdn.example.test/${k}`; }
}

async function setup(harness: TestDb, name: string, plan?: 'starter' | 'pro') {
  setStorage(new CdnStorage());
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  const seeded = await seedTenant(harness, name, plan ? { plan } : {});
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx, kv };
}

async function product(harness: TestDb, tenantId: string, over: Record<string, unknown>) {
  return ((await admin(harness, () => harness.db.insert(products).values({
    tenantId, name: 'Oyster 38', nameAr: 'أويستر 38', productType: 'watch', externalId: 'sa-1001', sku: 'OY-38',
    dimensions: { widthMm: 38, heightMm: 45 }, ...over,
  } as any).returning())) as any[])[0];
}

/** A model whose version 1 is live, with the web GLB, the plain GLB and the USDZ. */
async function liveModel(harness: TestDb, tenantId: string, productId: string) {
  const modelId = uuidv7();
  const versionId = uuidv7();
  const at = (f: string) => `t/${tenantId}/model/${modelId}/v1/${f}`;
  await admin(harness, async () => {
    await harness.db.insert(models3d).values({ id: modelId, tenantId, productId, name: 'Oyster', source: 'uploaded', status: 'ready', currentVersionId: versionId } as any);
    await harness.db.insert(modelVersions).values({ id: versionId, tenantId, modelId, version: 1, status: 'ready' } as any);
    await harness.db.insert(modelFiles).values([
      { tenantId, modelVersionId: versionId, format: 'glb', variant: 'original', storageKey: at('upload.glb') },
      { tenantId, modelVersionId: versionId, format: 'glb', variant: 'optimized', compression: 'meshopt', storageKey: at('optimized.glb') },
      { tenantId, modelVersionId: versionId, format: 'glb', variant: 'optimized', compression: 'none', storageKey: at('native.glb') },
      { tenantId, modelVersionId: versionId, format: 'usdz', variant: 'optimized', compression: 'none', storageKey: at('model.usdz') },
    ].map((f) => ({ id: uuidv7(), ...f })) as any);
  });
  return { modelId, versionId, at };
}

async function watchTryOn(harness: TestDb, tenantId: string, productId: string, over: Record<string, unknown> = {}) {
  await admin(harness, () => harness.db.insert(tryonConfigs).values({
    id: uuidv7(), tenantId, productId, category: 'watch',
    wornKey: `t/${tenantId}/photo/${productId}/worn.webp`, wornBytes: 100, flatKey: `t/${tenantId}/photo/${productId}/flat.webp`, flatBytes: 100,
    caseTenthsMm: 380, finishAr: 'فولاذ · ميناء أخضر', finishEn: 'Steel · green dial', enabled: true, ...over,
  } as any));
}

const stored = (kv: MemoryConfigStore, key: string) => {
  const body = kv.entries.get(key)?.body;
  return body === undefined ? null : JSON.parse(body);
};

test('a watch with a live model and try-on: one config both readers accept, at the address the widget asks for', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness, 'alpha', 'pro');
    const watch = await product(harness, tenantId, { arEnabled: true });
    const { at } = await liveModel(harness, tenantId, watch.id);
    await watchTryOn(harness, tenantId, watch.id);

    const status = await publishProduct(ctx, watch.id);
    assert.equal(status.version, 1);
    const key = 'alpha/sa-1001.json';
    assert.equal(configUrl('https://cfg.tajribah.com/v1', 'alpha', 'sa-1001'), `https://cfg.tajribah.com/v1/${key}`, 'the key is the widget’s own path');
    const config = stored(kv, key);
    assert.deepEqual(config.model, { glb: `https://cdn.example.test/${at('optimized.glb')}`, glbNative: `https://cdn.example.test/${at('native.glb')}`, usdz: `https://cdn.example.test/${at('model.usdz')}` });
    assert.deepEqual(config.product, { name: 'Oyster 38', nameAr: 'أويستر 38', widthMm: 38, heightMm: 45 });
    assert.deepEqual(config.button, { labelAr: 'جرّبها على معصمك', labelEn: 'Try it on your wrist', color: '#00A7BC', radius: 12, variant: 'solid', icon: true }, 'defaults until saved — a watch’s own words');
    assert.equal(config.placement, 'wrist');
    assert.deepEqual(config.tryon, {
      worn: `https://cdn.example.test/t/${tenantId}/photo/${watch.id}/worn.webp`, flat: `https://cdn.example.test/t/${tenantId}/photo/${watch.id}/flat.webp`,
      caseMm: 38, sku: 'OY-38', onMe: true, finish: { ar: 'فولاذ · ميناء أخضر', en: 'Steel · green dial' },
    });
    assert.ok(parseConfig(config), 'the widget reads it');
    const studio = tryOnProductFrom(config);
    assert.ok(studio, 'the try-on page reads it');
    assert.deepEqual([studio!.caseMm, studio!.finish.en, studio!.sku, studio!.onMe], [38, 'Steel · green dial', 'OY-38', true]);

    const [row] = await admin(harness, () => harness.db.select().from(edgeConfigs)) as any[];
    assert.deepEqual([row.key, row.version, !!row.fingerprint, row.withdrawnAt], [key, 1, true, null]);
    const trail = await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceType, 'edge_config'))) as any[];
    assert.deepEqual(trail.map((r) => [r.action, r.actorType]), [['publish', 'user']]);
  } finally { await harness.close(); }
});

test('a watch with try-on and no 3D model still gets its button; the plan decides "on me"', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness, 'beta'); // Starter
    const watch = await product(harness, tenantId, { externalId: null });
    await watchTryOn(harness, tenantId, watch.id, { finishAr: null, finishEn: null });
    await publishProduct(ctx, watch.id);
    const config = stored(kv, `beta/${watch.id}.json`);
    assert.ok(config, 'a product made in the dashboard is addressed by its own id');
    assert.equal(config.model, null);
    assert.equal(config.tryon.onMe, false, 'Starter: on the model and true size only (T33)');
    assert.equal(config.tryon.finish, null);
    assert.equal(parseConfig(config)?.tryon?.caseMm, 38);
    assert.equal(tryOnProductFrom(config)?.finish.en, 'At its real size');
  } finally { await harness.close(); }
});

test('nothing to open, an archived product, a closed store: refused with the reason, nothing written', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness, 'gamma');
    const plain = await product(harness, tenantId, { productType: 'furniture', externalId: 'sofa' });
    await assert.rejects(publishProduct(ctx, plain.id), (e: any) => code(e) === 'conflict' && /nothing for the button to open/.test(e.message));
    const off = await product(harness, tenantId, { externalId: 'w-off' });
    await liveModel(harness, tenantId, off.id);
    await assert.rejects(publishProduct(ctx, off.id), /nothing for the button/, 'a model is not shown while the product’s AR is off');
    const onTable = await product(harness, tenantId, { externalId: 'w-table' });
    await watchTryOn(harness, tenantId, onTable.id);
    await saveArConfig(ctx, onTable.id, { buttonLabelAr: 'اعرض', buttonLabelEn: 'View', variant: 'solid', showIcon: true, placement: 'table', scale: 1, autoRotate: true, shadow: 1 });
    await assert.rejects(publishProduct(ctx, onTable.id), /nothing for the button/, 'try-on opens only from the wrist');
    const gone = await product(harness, tenantId, { externalId: 'gone', status: 'archived', arEnabled: true });
    await liveModel(harness, tenantId, gone.id);
    await assert.rejects(publishProduct(ctx, gone.id), /archived or deleted/);
    await admin(harness, () => harness.db.update(tenants).set({ status: 'cancelled' } as any).where(eq(tenants.id, tenantId)));
    const closedCtx = await buildTenantContext({ actor: ctx.actor, tenantId, requestId: 'req-closed' });
    const watch = await product(harness, tenantId, { externalId: 'w-ok', arEnabled: true });
    await liveModel(harness, tenantId, watch.id);
    await assert.rejects(publishProduct(closedCtx, watch.id), /suspended or closed/);
    assert.equal(kv.entries.size, 0);
    assert.equal((await admin(harness, () => harness.db.select().from(edgeConfigs))).length, 0);
  } finally { await harness.close(); }
});

test('a config the widget would refuse never leaves: local storage’s links are not https', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness, 'iota');
    setStorage(new MemoryStorage()); // memory://… links, as in local development
    const watch = await product(harness, tenantId, { arEnabled: true, name: 'x'.repeat(250) });
    await liveModel(harness, tenantId, watch.id);
    await assert.rejects(publishProduct(ctx, watch.id), /not make a valid config/);
    assert.equal(kv.entries.size, 0);
    setStorage(new CdnStorage());
    await publishProduct(ctx, watch.id);
    assert.equal(stored(kv, 'iota/sa-1001.json').product.name.length, 200, 'a long synced name is cut to the contract, not refused');
  } finally { await harness.close(); }
});

test('publishing needs ar:publish — an analyst cannot', async () => {
  const harness = await createTestDb();
  try {
    const { tenantId, kv } = await setup(harness, 'delta');
    const watch = await product(harness, tenantId, { arEnabled: true });
    await liveModel(harness, tenantId, watch.id);
    const analystId = uuidv7();
    await admin(harness, async () => {
      await harness.db.insert(users).values({ id: analystId, email: 'analyst@example.test', passwordHash: 'x', fullName: 'A' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId: analystId, role: 'analyst', status: 'active' } as any);
    });
    const analyst = await buildTenantContext({ actor: { userId: analystId, email: 'analyst@example.test', isStaff: false }, tenantId, requestId: 'req-a' });
    await assert.rejects(publishProduct(analyst, watch.id), (e: any) => code(e) === 'forbidden');
    assert.equal(kv.entries.size, 0);
  } finally { await harness.close(); }
});

test('the screen says what shoppers see: live version, and changes from any source', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await setup(harness, 'eps', 'pro');
    const watch = await product(harness, tenantId, { arEnabled: true });
    await liveModel(harness, tenantId, watch.id);
    const view = async () => (await listArConfigs(ctx)).find((c) => c.productId === watch.id)!;
    assert.deepEqual([(await view()).publishedVersion, (await view()).unpublishedChanges], [0, false], 'not published, nothing saved');
    await publishProduct(ctx, watch.id);
    const live = await view();
    assert.deepEqual([live.publishedVersion, live.unpublishedChanges, typeof live.publishedAt], [1, false, 'string']);
    const saved = await saveArConfig(ctx, watch.id, { buttonLabelAr: 'جرّبها', buttonLabelEn: 'Try it', variant: 'outline', showIcon: false, placement: 'wrist', scale: 1, autoRotate: true, shadow: 1 });
    assert.deepEqual([saved.publishedVersion, saved.unpublishedChanges], [1, true], 'a saved label is not yet on the shop');
    await publishProduct(ctx, watch.id);
    assert.deepEqual([(await view()).publishedVersion, (await view()).unpublishedChanges], [2, false]);
    // Not the settings row: the try-on is set up after publishing — the screen still sees the change.
    await watchTryOn(harness, tenantId, watch.id);
    assert.equal((await view()).unpublishedChanges, true);
  } finally { await harness.close(); }
});

test('kept true: try-on switched off, AR off, the product archived — rewritten or withdrawn; back when it qualifies again', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness, 'zeta', 'pro');
    const watch = await product(harness, tenantId, { arEnabled: true });
    await liveModel(harness, tenantId, watch.id);
    await watchTryOn(harness, tenantId, watch.id);
    await publishProduct(ctx, watch.id);
    const key = 'zeta/sa-1001.json';

    await updateTryOn(ctx, watch.id, { enabled: false });
    assert.equal(stored(kv, key).tryon, null, 'switched off → gone from the shop at once, the model stays');
    assert.equal(kv.entries.get(key)!.version, 2);

    await updateProduct(ctx, watch.id, { arEnabled: false });
    assert.equal(stored(kv, key), null, 'nothing left to open → withdrawn; the widget draws nothing');
    const [row] = await admin(harness, () => harness.db.select().from(edgeConfigs)) as any[];
    assert.deepEqual([row.key, !!row.withdrawnAt], [key, true], 'the address is kept');
    assert.equal((await listArConfigs(ctx)).find((c) => c.productId === watch.id)!.publishedVersion, 0, 'shown as not published');
    assert.deepEqual([...(await refreshStore(tenantId, watch.id, 'r1'))], [[watch.id, 'unchanged']], 'withdrawing twice is nothing');

    await updateProduct(ctx, watch.id, { arEnabled: true });
    assert.ok(stored(kv, key)?.model, 'AR back on → published again: the merchant never took it back');

    const never = await product(harness, tenantId, { externalId: 'never', arEnabled: true });
    await liveModel(harness, tenantId, never.id);
    assert.deepEqual([...(await refreshStore(tenantId, never.id, 'r2'))], [[never.id, 'never_published']]);
    assert.equal(await refreshProduct(ctx, never.id, await entitlementsOf(ctx)), 'never_published');
    assert.equal(stored(kv, 'zeta/never.json'), null, 'a refresh never publishes what the merchant did not');

    const trail = await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceType, 'edge_config'))) as any[];
    assert.deepEqual(trail.map((r) => r.action), ['publish', 'publish', 'unpublish', 'publish']);
  } finally { await harness.close(); }
});

test('a suspended store’s buttons leave its shop and come back when it is restored; a new platform id moves the entry', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness, 'eta', 'pro');
    const a = await product(harness, tenantId, { externalId: 'a', arEnabled: true });
    const b = await product(harness, tenantId, { externalId: 'b', arEnabled: true });
    await liveModel(harness, tenantId, a.id);
    await liveModel(harness, tenantId, b.id);
    await publishProduct(ctx, a.id);
    await publishProduct(ctx, b.id);
    assert.deepEqual([...kv.entries.keys()].sort(), ['eta/a.json', 'eta/b.json']);

    await admin(harness, () => harness.db.update(tenants).set({ status: 'suspended' } as any).where(eq(tenants.id, tenantId)));
    const out = await refreshStore(tenantId, null, 'r-suspend');
    assert.deepEqual([...out.values()], ['withdrawn', 'withdrawn']);
    assert.equal(kv.entries.size, 0);
    await admin(harness, () => harness.db.update(tenants).set({ status: 'active' } as any).where(eq(tenants.id, tenantId)));
    assert.deepEqual([...(await refreshStore(tenantId, null, 'r-restore')).values()], ['rewritten', 'rewritten']);
    assert.deepEqual([...kv.entries.keys()].sort(), ['eta/a.json', 'eta/b.json']);
    assert.deepEqual([...(await refreshStore(tenantId, null, 'r-again')).values()], ['unchanged', 'unchanged'], 'nothing changed → nothing written');

    await admin(harness, () => harness.db.update(products).set({ externalId: 'a2' } as any).where(eq(products.id, a.id)));
    await refreshStore(tenantId, a.id, 'r-move');
    assert.deepEqual([...kv.entries.keys()].sort(), ['eta/a2.json', 'eta/b.json'], 'one product never answers at two addresses');
  } finally { await harness.close(); }
});

test('the store’s colours reach every live button through the queue', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness, 'theta', 'pro');
    const watch = await product(harness, tenantId, { arEnabled: true });
    await liveModel(harness, tenantId, watch.id);
    await publishProduct(ctx, watch.id);
    await updateSettings(ctx, { brandColor: '#0B7A75', buttonRadius: 20 });
    const queued = await admin(harness, () => harness.db.select().from(jobs).where(eq(jobs.queue, 'edge.publish-config'))) as any[];
    assert.equal(queued.length, 1, 'one store-wide refresh');
    assert.equal(queued[0].tenantId, tenantId);
    assert.equal(stored(kv, 'theta/sa-1001.json').button.color, '#00A7BC', 'not before the job runs');
    await handleEdgeJob(queued[0]);
    assert.deepEqual([stored(kv, 'theta/sa-1001.json').button.color, stored(kv, 'theta/sa-1001.json').button.radius], ['#0B7A75', 20]);
  } finally { await harness.close(); }
});

test('T36: a live watch’s replaced picture is kept for shoppers still holding the old config, then deleted', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness, 'kappa', 'pro');
    const watch = await product(harness, tenantId, {});
    const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'server/modules/tryon/__tests__/fixtures', name)));
    const store = forTenant(tenantId);
    const upload = async (slot: 'worn' | 'flat', name: string, type = 'image/png') => {
      const started = await startCutoutUpload(ctx, watch.id, { slot, filename: name, contentType: type, sizeBytes: fixture(name).length });
      await store.put(started.key, fixture(name).slice().buffer as ArrayBuffer);
      await confirmCutout(ctx, watch.id, { slot, key: started.key });
      return started.key;
    };
    const first = await upload('worn', 'worn.png');
    await upload('flat', 'flat.png');
    await updateTryOn(ctx, watch.id, { caseMm: 38, enabled: true });
    await publishProduct(ctx, watch.id);
    assert.match(stored(kv, 'kappa/sa-1001.json').tryon.worn, new RegExp(first + '$'));

    const second = await upload('worn', 'worn.webp', 'image/webp');
    assert.match(stored(kv, 'kappa/sa-1001.json').tryon.worn, new RegExp(second + '$'), 'the live config names the new picture at once');
    assert.ok(await store.head(first), 'the old one is still there for cached copies');
    const [job] = await admin(harness, () => harness.db.select().from(jobs).where(eq(jobs.queue, 'storage.delete-later'))) as any[];
    assert.ok(job.runAfter.getTime() - Date.now() > 9 * 60_000, 'deleted after the grace period, not before');
    await handleDeleteLater(job);
    assert.equal(await store.head(first), null);
    // A job for a picture that is current again deletes nothing.
    await handleDeleteLater({ ...job, payload: { productId: watch.id, key: second } });
    assert.ok(await store.head(second));

    // Just withdrawn still counts: a cached copy may still be out there. Long withdrawn does not.
    await updateTryOn(ctx, watch.id, { enabled: false });
    assert.equal(stored(kv, 'kappa/sa-1001.json'), null, 'nothing left to open → withdrawn');
    assert.equal(await isLive(tenantId, watch.id), true);
    await admin(harness, () => harness.db.update(edgeConfigs).set({ withdrawnAt: new Date(Date.now() - 11 * 60_000) } as any).where(eq(edgeConfigs.productId, watch.id)));
    assert.equal(await isLive(tenantId, watch.id), false);
  } finally { await harness.close(); }
});

test('the config host: the published body, public and briefly cached; nothing else', async () => {
  const kv = new MemoryConfigStore();
  await kv.put(configKey('alpha', 'gid://shopify/Product/7'), '{"v":1}', 1);
  const res = await serveConfig(new Request(`https://cfg.tajribah.com/v1/alpha/${encodeURIComponent('gid://shopify/Product/7')}.json`), kv);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"v":1}');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.match(res.headers.get('cache-control')!, /public, max-age=60/);
  const missing = await serveConfig(new Request('https://cfg.tajribah.com/v1/alpha/none.json'), kv);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('cache-control')!, /max-age=60/, '"none" is cached briefly too');
  assert.equal((await serveConfig(new Request('https://cfg.tajribah.com/v1/alpha/x.json', { method: 'POST' }), kv)).status, 405);
  assert.equal((await serveConfig(new Request('https://cfg.tajribah.com/v1/alpha/x.json', { method: 'OPTIONS' }), kv)).status, 204);
  for (const path of ['/v1/alpha.json', '/v2/alpha/x.json', '/v1/alpha/x.txt', '/v1/a/b/c.json', '/v1/alpha/%E0%A4%A.json', '/v1//x.json']) {
    assert.equal(keyOf(path), null, path);
  }
  assert.equal(keyOf('/v1/alpha/sa-1.json'), 'alpha/sa-1.json');
  assert.equal(keyOf('/v1/alpha/a%2Fb.json'), 'alpha/a%2Fb.json', 'an encoded slash stays one segment');
});
