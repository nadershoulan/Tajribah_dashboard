/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P1.19 — a product's own page. The published config carries its `page` block (the store's name, the
 * merchant's buy link, "Made with Tajribah" unless white-label); the AR settings screen shows the
 * page's address while the product is published; switching it off or changing the link reaches the
 * config at once, audited. The website's reader (`tajribah-try-on/lib/hosted-page.ts`) is run here on
 * exactly what is published, and its copy of the AR path is held equal to the widget's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { auditLogs, customDomains, hostedPages, models3d, modelFiles, modelVersions, products, tenantMemberships, tenants, tryonConfigs, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { HostedPageInput, hostedPageUrl, isShopUrl } from '@/lib/contracts/hosted-page';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { listArConfigs } from '@/server/modules/ar/service';
import { publishProduct, unpublishProduct } from '@/server/modules/edge/publish';
import { getHostedPage, saveHostedPage } from '@/server/modules/hosted-pages/service';
import { parseConfig } from '@/widget/src/config';
import { arPath as widgetArPath, detectDevice as widgetDetect, sceneViewerIntent as widgetIntent } from '@/widget/src/ar';
import { arPath, detectDevice, hostedProductFrom, sceneViewerIntent, shopLink, sizeLine } from '@site/lib/hosted-page';
import { servesHere } from '@site/lib/store-host';

setLogLevel('error');
const ENV = { APP_URL: 'http://localhost:5173', AUTH_SECRET: 'a'.repeat(40), ENCRYPTION_KEY: 'b'.repeat(40) };

class CdnStorage extends MemoryStorage {
  publicUrl(k: string) { return `https://cdn.example.test/${k}`; }
}

async function store(harness: TestDb, name: string, plan: 'starter' | 'pro' | 'enterprise', env: Record<string, string> = {}) {
  resetEnv();
  loadEnv({ ...ENV, ...env });
  setStorage(new CdnStorage());
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  const seeded = await seedTenant(harness, name, { plan });
  await harness.asAdmin(() => harness.db.update(tenants).set({ name: 'Oud House', nameAr: 'بيت العود' } as any).where(eq(tenants.id, seeded.tenantId)));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx, kv };
}

/** A lamp with a live model (web GLB, plain GLB, USDZ): something placed in a room. */
async function lamp(harness: TestDb, tenantId: string) {
  const [row] = (await harness.asAdmin(() => harness.db.insert(products).values({
    tenantId, name: 'Arc lamp', nameAr: 'مصباح القوس', productType: 'other', externalId: 'sa-77', arEnabled: true, dimensions: { widthMm: 420, heightMm: 1650 },
  } as any).returning())) as any[];
  const modelId = uuidv7();
  const versionId = uuidv7();
  const at = (f: string) => `t/${tenantId}/model/${modelId}/v1/${f}`;
  await harness.asAdmin(async () => {
    await harness.db.insert(models3d).values({ id: modelId, tenantId, productId: row.id, name: 'Arc', source: 'uploaded', status: 'ready', currentVersionId: versionId } as any);
    await harness.db.insert(modelVersions).values({ id: versionId, tenantId, modelId, version: 1, status: 'ready' } as any);
    await harness.db.insert(modelFiles).values([
      { tenantId, modelVersionId: versionId, format: 'glb', variant: 'optimized', compression: 'meshopt', storageKey: at('optimized.glb') },
      { tenantId, modelVersionId: versionId, format: 'glb', variant: 'optimized', compression: 'none', storageKey: at('native.glb') },
      { tenantId, modelVersionId: versionId, format: 'usdz', variant: 'optimized', compression: 'none', storageKey: at('model.usdz') },
    ].map((f) => ({ id: uuidv7(), ...f })) as any);
  });
  return row;
}

/** A watch with only the try-on set up (no 3D model). */
async function watch(harness: TestDb, tenantId: string) {
  const [row] = (await harness.asAdmin(() => harness.db.insert(products).values({
    tenantId, name: 'Oyster 38', nameAr: 'أويستر 38', productType: 'watch', externalId: 'sa-1001', sku: 'OY-38', dimensions: { widthMm: 38, heightMm: 45 },
  } as any).returning())) as any[];
  await harness.asAdmin(() => harness.db.insert(tryonConfigs).values({
    id: uuidv7(), tenantId, productId: row.id, category: 'watch',
    wornKey: `t/${tenantId}/photo/${row.id}/worn.webp`, wornBytes: 100, flatKey: `t/${tenantId}/photo/${row.id}/flat.webp`, flatBytes: 100,
    caseTenthsMm: 380, enabled: true,
  } as any));
  return row;
}

const stored = (kv: MemoryConfigStore, key: string) => {
  const body = kv.entries.get(key)?.body;
  return body === undefined ? null : JSON.parse(body);
};

test('a published product has a page: its block in the config, its address on the AR settings screen, the website reads it', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'oud', 'starter');
    const row = await lamp(harness, tenantId);
    const before = (await listArConfigs(ctx)).find((c) => c.productId === row.id)!;
    assert.deepEqual(before.page, { url: null, active: true, shopUrl: null }, 'not published: no address yet, on by default');

    await publishProduct(ctx, row.id);
    const config = stored(kv, 'oud/sa-77.json');
    assert.deepEqual(config.page, { store: { name: 'Oud House', nameAr: 'بيت العود' }, shopUrl: null, poweredBy: true, host: null, ga4: null }, 'Starter has the page; "Made with Tajribah" shown');
    assert.ok(parseConfig(config), 'the shop’s widget still reads the config');
    const view = (await listArConfigs(ctx)).find((c) => c.productId === row.id)!;
    assert.equal(view.page?.url, 'https://tajribah.sa/p/oud/sa-77', 'the address: the config’s own store key and product reference');
    assert.equal(view.unpublishedChanges, false, 'the page block is part of what is live, not a pending change');

    const page = hostedProductFrom(config)!;
    assert.ok(page, 'the website’s page reads what is published');
    assert.deepEqual(page.name, { ar: 'مصباح القوس', en: 'Arc lamp' });
    assert.deepEqual(page.store, { ar: 'بيت العود', en: 'Oud House' });
    assert.equal(page.model?.usdz?.endsWith('model.usdz'), true);
    assert.equal(page.model?.glbNative?.endsWith('native.glb'), true);
    assert.equal(page.tryon, null);
    assert.equal(page.shopUrl, null);
    assert.equal(page.poweredBy, true);
    assert.equal(sizeLine(page, 'ar'), '420 × 1650 مم');
    assert.equal(sizeLine(page, 'en'), '420 × 1650 mm');

    await unpublishProduct(ctx, row.id);
    assert.equal((await getHostedPage(ctx, row.id)).url, null, 'taken off the shop: the page goes with it');
  } finally { await harness.close(); resetEnv(); }
});

test('switching the page off and setting the buy link reach the live config at once, audited', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'oud2', 'pro');
    const row = await watch(harness, tenantId);
    await publishProduct(ctx, row.id);

    const saved = await saveHostedPage(ctx, row.id, { active: true, shopUrl: 'https://oud.example.sa/p/oyster-38' });
    assert.deepEqual(saved, { url: 'https://tajribah.sa/p/oud2/sa-1001', active: true, shopUrl: 'https://oud.example.sa/p/oyster-38' });
    const config = stored(kv, 'oud2/sa-1001.json');
    assert.equal(config.page.shopUrl, 'https://oud.example.sa/p/oyster-38', 'rewritten at once');
    const page = hostedProductFrom(config)!;
    assert.deepEqual(page.tryon?.storeLink, { label: { ar: 'اشترها من بيت العود', en: 'Buy it at Oud House' }, href: 'https://oud.example.sa/p/oyster-38' },
      'a watch: the buy link goes in the studio’s own store link');
    assert.equal(page.image?.endsWith('flat.webp'), true, 'the watch’s picture for link previews');

    await saveHostedPage(ctx, row.id, { active: false, shopUrl: 'https://oud.example.sa/p/oyster-38' });
    const off = stored(kv, 'oud2/sa-1001.json');
    assert.equal(off.page, null, 'switched off: no page block');
    assert.equal(hostedProductFrom(off), null, 'and the website says the page is not available');
    assert.ok(parseConfig(off), 'the shop’s button is not affected');

    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceType, 'hosted_page'))));
    assert.equal(trail.length, 2, 'created, then changed');
    await saveHostedPage(ctx, row.id, { active: false, shopUrl: 'https://oud.example.sa/p/oyster-38' });
    const again = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceType, 'hosted_page'))));
    assert.equal(again.length, 2, 'saving the same choice records nothing');

    // A link that reached the table some other way is checked again before it reaches shoppers.
    await harness.asAdmin(() => harness.db.update(hostedPages).set({ isActive: true, shopUrl: 'javascript:alert(1)' } as any).where(eq(hostedPages.productId, row.id)));
    await publishProduct(ctx, row.id);
    assert.equal(stored(kv, 'oud2/sa-1001.json').page.shopUrl, null);
  } finally { await harness.close(); resetEnv(); }
});

test('only an https link to a real host is accepted, from someone who may publish', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'oud3', 'pro');
    const row = await watch(harness, tenantId);
    for (const bad of ['http://oud.example.sa/x', 'javascript:alert(1)', 'https://user:pw@oud.example.sa/', 'https://localhost/x', 'oud.example.sa']) {
      await assert.rejects(() => saveHostedPage(ctx, row.id, { active: true, shopUrl: bad }), (e: any) => e.code === 'validation_failed' && !!e.errors?.shopUrl, bad);
    }
    assert.equal((await saveHostedPage(ctx, row.id, { active: true, shopUrl: '  ' })).shopUrl, null, 'blank: no link');
    await assert.rejects(() => saveHostedPage(ctx, row.id, { active: true, shopUrl: null, extra: 1 }), (e: any) => e.code === 'validation_failed', 'nothing else is accepted');

    const viewerId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: viewerId, email: 'viewer@oud.sa', passwordHash: 'x', fullName: 'V' } as any);
      await harness.db.insert(tenantMemberships).values({ tenantId, userId: viewerId, role: 'viewer' } as any);
    });
    const viewer = await buildTenantContext({ actor: { userId: viewerId, email: 'viewer@oud.sa', isStaff: false }, tenantId, requestId: 'r' });
    await assert.rejects(() => saveHostedPage(viewer, row.id, { active: false, shopUrl: null }), (e: any) => e.code === 'forbidden');
    assert.equal((await getHostedPage(viewer, row.id)).active, true, 'a viewer can see it');

    const other = await store(harness, 'other', 'pro');
    await assert.rejects(() => saveHostedPage(other.ctx, row.id, { active: false, shopUrl: null }), (e: any) => e.code === 'not_found', 'another store’s product does not exist');
  } finally { await harness.close(); resetEnv(); }
});

test('white-label drops "Made with Tajribah"; the address follows HOSTED_PAGE_BASE', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'ward', 'enterprise', { HOSTED_PAGE_BASE: 'https://tjr.sa' });
    const row = await watch(harness, tenantId);
    await publishProduct(ctx, row.id);
    assert.equal(stored(kv, 'ward/sa-1001.json').page.poweredBy, false);
    assert.equal(hostedProductFrom(stored(kv, 'ward/sa-1001.json'))!.poweredBy, false);
    assert.equal((await getHostedPage(ctx, row.id)).url, 'https://tjr.sa/ward/sa-1001');
  } finally { await harness.close(); resetEnv(); }
});

test('the website’s reader refuses what it must not show', () => {
  const good = {
    v: 1, product: { name: 'Arc lamp', nameAr: null, widthMm: 420, heightMm: null },
    model: { glb: 'https://cdn.example.test/a.glb', glbNative: null, usdz: null },
    placement: 'floor', scale: 1, autoRotate: true, shadow: 1, tryon: null, brand: null, host: null,
    page: { store: { name: 'Oud House', nameAr: null }, shopUrl: 'https://oud.example.sa/x', poweredBy: true },
  };
  assert.ok(hostedProductFrom(good));
  assert.equal(sizeLine(hostedProductFrom(good)!, 'en'), null, 'one size missing: no size line');
  assert.equal(hostedProductFrom({ ...good, page: null }), null, 'switched off');
  assert.equal(hostedProductFrom({ ...good, v: 2 }), null, 'an unknown version');
  assert.equal(hostedProductFrom({ ...good, model: { glb: 'http://cdn.example.test/a.glb' } }), null, 'nothing to show over http');
  assert.equal(hostedProductFrom({ ...good, model: { glb: 'http://localhost:9000/a.glb' } }, true)?.model?.glb, 'http://localhost:9000/a.glb', 'a local file only on this machine');
  assert.equal(hostedProductFrom({ ...good, page: { ...good.page, shopUrl: 'javascript:alert(1)' } })!.shopUrl, null, 'a bad buy link is dropped, not followed');
  assert.equal(hostedProductFrom({ ...good, page: { ...good.page, store: { name: '' } } }), null, 'a store without a name');
  const hostOf = (host: unknown) => hostedProductFrom({ ...good, page: { ...good.page, host } })!.host;
  assert.equal(hostOf('ar.oud.sa'), 'ar.oud.sa', 'a store’s own address');
  for (const bad of ['10.0.0.1', '192.168.1.20', 'oud.sa', 'https://ar.oud.sa', 'ar.oud.sa/p', 'AR.OUD.SA', '', 42]) assert.equal(hostOf(bad), null, `not an address: ${String(bad)}`);
  for (const v of ['https://oud.example.sa/x', 'http://oud.example.sa/x', 'https://a:b@oud.example.sa/', 'https://localhost/', 'ftp://x.sa', '']) {
    assert.equal(shopLink(v) !== null, isShopUrl(v), `the platform and the website agree on "${v}"`);
  }
  assert.equal(HostedPageInput.safeParse({ active: true, shopUrl: 'https://oud.example.sa/x' }).success, true);
  assert.equal(hostedPageUrl('https://tajribah.sa/p/', 'a b', 'x/y'), 'https://tajribah.sa/p/a%20b/x%2Fy', 'encoded as the config key is');
});

test('the website’s copy of the AR path is the widget’s', () => {
  const uas = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5, true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, true],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5, false],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0, false],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5, false],
  ] as const;
  const models = [
    { glb: 'https://c.test/a.glb', glbNative: 'https://c.test/n.glb', usdz: 'https://c.test/m.usdz' },
    { glb: 'https://c.test/a.glb', glbNative: null, usdz: null },
  ];
  for (const [ua, touch, ar] of uas) {
    assert.deepEqual(detectDevice(ua, touch, ar), widgetDetect(ua, touch, ar));
    for (const model of models) {
      for (const placement of ['floor', 'wall', 'table', 'face', 'wrist'] as const) {
        const config: any = { v: 1, product: { name: 'Arc lamp', nameAr: 'مصباح القوس', widthMm: null, heightMm: null }, model, placement };
        assert.deepEqual(
          arPath(detectDevice(ua, touch, ar), { model, placement, name: 'مصباح القوس' }, 'https://tajribah.sa/p/oud/sa-77'),
          widgetArPath(widgetDetect(ua, touch, ar), config, 'https://tajribah.sa/p/oud/sa-77'),
          `${ua} · ${placement} · ${model.usdz ? 'all files' : 'web only'}`,
        );
      }
    }
  }
  const config: any = { product: { name: 'Arc lamp', nameAr: null }, placement: 'wall' };
  assert.equal(sceneViewerIntent('https://c.test/n.glb', { placement: 'wall', name: 'Arc lamp' }, 'https://x.test/p'), widgetIntent('https://c.test/n.glb', config, 'https://x.test/p'));
});

test('T62: on the store’s own address — the config names it, the link uses it, and only that store’s pages show there', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'ward2', 'enterprise');
    const row = await watch(harness, tenantId);
    await harness.asAdmin(() => harness.db.insert(customDomains).values({ id: uuidv7(), tenantId, hostname: 'ar.ward.sa', token: 't'.repeat(32), status: 'active' } as any));
    await publishProduct(ctx, row.id);
    const config = stored(kv, 'ward2/sa-1001.json');
    assert.equal(config.page.host, 'ar.ward.sa');
    assert.equal((await getHostedPage(ctx, row.id)).url, 'https://ar.ward.sa/p/ward2/sa-1001', 'the link the merchant shares is on their address');
    assert.equal((await listArConfigs(ctx)).find((c) => c.productId === row.id)!.page?.url, 'https://ar.ward.sa/p/ward2/sa-1001');
    const page = hostedProductFrom(config)!;
    assert.equal(page.host, 'ar.ward.sa');
    assert.equal(servesHere('ar.ward.sa', page.host), true, 'shown on its own address');
    assert.equal(servesHere('ar.other.sa', page.host), false, 'not on another store’s');
    assert.equal(servesHere(null, page.host), true, 'and still on Tajribah’s');
    assert.equal(servesHere('ar.ward.sa', config.host), true, 'the try-on frame there too');

    const pro = await store(harness, 'oud4', 'pro');
    const other = await watch(harness, pro.tenantId);
    await harness.asAdmin(() => harness.db.insert(customDomains).values({ id: uuidv7(), tenantId: pro.tenantId, hostname: 'ar.oud.sa', token: 'u'.repeat(32), status: 'active' } as any));
    await publishProduct(pro.ctx, other.id);
    assert.equal(stored(pro.kv, 'oud4/sa-1001.json').page.host, null, 'a plan without custom domains: no address of its own');
    assert.equal((await getHostedPage(pro.ctx, other.id)).url, 'https://tajribah.sa/p/oud4/sa-1001');
    assert.equal(servesHere('ar.ward.sa', hostedProductFrom(stored(pro.kv, 'oud4/sa-1001.json'))!.host), false, 'and never under Ward’s address');
  } finally { await harness.close(); resetEnv(); }
});
