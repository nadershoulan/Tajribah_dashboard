/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T61 — white-label (Enterprise): the store's own name and logo where shoppers would see Tajribah's —
 * the try-on page's bar and title, and the phone page a QR code opens. The config carries the brand;
 * the website's readers (`tryon-config.ts`, `pair-brand.ts`) are tested here against what is published.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { jobs, products, tenants, tenantSettings, tryonConfigs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { handleEdgeJob, publishProduct } from '@/server/modules/edge/publish';
import { updateSettings } from '@/server/modules/settings/service';
import { parseConfig } from '@/widget/src/config';
import { brandFrom, CONFIG_BASE, embedTitle, tryOnProductFrom } from '@site/lib/tryon-config';
import { brandOfPairing, embedRefsOf } from '@site/lib/pair-brand';

setLogLevel('error');

class CdnStorage extends MemoryStorage {
  publicUrl(k: string) { return `https://cdn.example.test/${k}`; }
}

async function store(harness: TestDb, name: string, plan: 'pro' | 'enterprise', over: Record<string, unknown> = {}) {
  setStorage(new CdnStorage());
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  const seeded = await seedTenant(harness, name, { plan });
  await harness.asAdmin(() => harness.db.update(tenants).set({ name: 'Maison Ward', nameAr: 'ميزون وارد', ...over } as any).where(eq(tenants.id, seeded.tenantId)));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx, kv };
}

async function watch(harness: TestDb, tenantId: string, tryon = true) {
  const [row] = (await harness.asAdmin(() => harness.db.insert(products).values({
    tenantId, name: 'Oyster 38', nameAr: 'أويستر 38', productType: 'watch', externalId: 'sa-1001', sku: 'OY-38', dimensions: { widthMm: 38, heightMm: 45 },
  } as any).returning())) as any[];
  if (tryon) {
    await harness.asAdmin(() => harness.db.insert(tryonConfigs).values({
      id: uuidv7(), tenantId, productId: row.id, category: 'watch',
      wornKey: `t/${tenantId}/photo/${row.id}/worn.webp`, wornBytes: 100, flatKey: `t/${tenantId}/photo/${row.id}/flat.webp`, flatBytes: 100,
      caseTenthsMm: 380, enabled: true,
    } as any));
  }
  return row;
}

const stored = (kv: MemoryConfigStore, key: string) => JSON.parse(kv.entries.get(key)!.body);

test('Enterprise: the try-on config carries the store’s name and logo; the try-on page reads them', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'ward', 'enterprise', { logoUrl: 'https://shop.example.sa/logo.png' });
    const product = await watch(harness, tenantId);
    await publishProduct(ctx, product.id);
    const config = stored(kv, 'ward/sa-1001.json');
    assert.deepEqual(config.brand, { name: 'Maison Ward', nameAr: 'ميزون وارد', logo: 'https://shop.example.sa/logo.png' });
    assert.ok(parseConfig(config), 'the shop’s widget still reads it');
    assert.ok(tryOnProductFrom(config), 'and the studio');
    const brand = brandFrom(config);
    assert.deepEqual(brand, { name: { ar: 'ميزون وارد', en: 'Maison Ward' }, logo: 'https://shop.example.sa/logo.png' });
    assert.equal(embedTitle(brand, 'ar'), 'ميزون وارد · تجربة افتراضية');
    assert.equal(embedTitle(brand, 'en'), 'Maison Ward · Virtual try-on');
    assert.equal(embedTitle(null, 'ar'), 'Tajribah try-on', 'no brand: Tajribah’s title, as before');
  } finally { await harness.close(); }
});

test('the Settings logo comes first; a logo that is not https is left out and the name stands alone', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'ward2', 'enterprise', { logoUrl: 'http://shop.example.sa/logo.png', nameAr: null });
    const product = await watch(harness, tenantId);
    await publishProduct(ctx, product.id);
    assert.deepEqual(stored(kv, 'ward2/sa-1001.json').brand, { name: 'Maison Ward', nameAr: null, logo: null });
    assert.deepEqual(brandFrom(stored(kv, 'ward2/sa-1001.json')), { name: { ar: 'Maison Ward', en: 'Maison Ward' }, logo: null }, 'no Arabic name: the store’s own in both');

    await harness.asAdmin(() => harness.db.insert(tenantSettings).values({ tenantId, branding: { logoUrl: 'https://cdn.example.sa/brand.svg' } } as any));
    await publishProduct(ctx, product.id);
    assert.equal(stored(kv, 'ward2/sa-1001.json').brand.logo, 'https://cdn.example.sa/brand.svg');
    await harness.asAdmin(() => harness.db.update(tenants).set({ logoUrl: 'https://shop.example.sa/logo.png' } as any).where(eq(tenants.id, tenantId)));
    const fresh = await buildTenantContext({ actor: ctx.actor, tenantId, requestId: 'req-ward2b' });
    await publishProduct(fresh, product.id);
    assert.equal(stored(kv, 'ward2/sa-1001.json').brand.logo, 'https://cdn.example.sa/brand.svg', 'both usable: the Settings one');
  } finally { await harness.close(); }
});

test('every other plan: no brand — Tajribah’s name, as before', async () => {
  const harness = await createTestDb();
  try {
    const pro = await store(harness, 'prostore', 'pro', { logoUrl: 'https://shop.example.sa/logo.png' });
    const product = await watch(harness, pro.tenantId);
    await publishProduct(pro.ctx, product.id);
    const config = stored(pro.kv, 'prostore/sa-1001.json');
    assert.equal(config.brand, null);
    assert.equal(brandFrom(config), null);
  } finally { await harness.close(); }
});

test('renaming the store refreshes its live configs, so the new name reaches shoppers', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'ward3', 'enterprise');
    const product = await watch(harness, tenantId);
    await publishProduct(ctx, product.id);
    await updateSettings(ctx, { name: 'Ward & Sons', nameAr: 'وارد وأبناؤه' } as any);
    const queued = await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.queue, 'edge.publish-config'))) as any[];
    assert.equal(queued.length, 1, 'one store-wide refresh');
    await handleEdgeJob(queued[0]);
    assert.deepEqual(stored(kv, 'ward3/sa-1001.json').brand, { name: 'Ward & Sons', nameAr: 'وارد وأبناؤه', logo: null });
  } finally { await harness.close(); }
});

test('the try-on page refuses a brand it cannot trust: too long, not https, the wrong shape', () => {
  const base = { brand: { name: 'Maison Ward', nameAr: null, logo: null } };
  assert.ok(brandFrom(base));
  assert.equal(brandFrom({ brand: { ...base.brand, name: 'x'.repeat(81) } }), null);
  assert.equal(brandFrom({ brand: { ...base.brand, name: '' } }), null);
  assert.equal(brandFrom({ brand: { ...base.brand, nameAr: 7 } }), null);
  assert.equal(brandFrom({ brand: { ...base.brand, logo: 'http://shop.example.sa/logo.png' } }), null);
  assert.equal(brandFrom({ brand: { ...base.brand, logo: 'javascript:alert(1)' } }), null);
  assert.ok(brandFrom({ brand: { ...base.brand, logo: 'http://localhost:9000/logo.png' } }, true), 'a test on this machine may use a local picture');
  assert.equal(brandFrom({ brand: 'Maison Ward' }), null);
  assert.equal(brandFrom(null), null);
});

const pairing = (referer: string | null, url = 'https://tajribah.sa/api/pair') =>
  new Request(url, { method: 'POST', headers: referer ? { referer } : {} });

test('the phone page’s brand comes from the try-on frame the QR code started in — and from the config host, not the request', async () => {
  assert.deepEqual(embedRefsOf(pairing('https://tajribah.sa/embed/try-on?store=ward&product=sa-1001&lang=ar')), { store: 'ward', product: 'sa-1001', base: null });
  assert.equal(embedRefsOf(pairing('https://tajribah.sa/demo')), null, 'the demo page: Tajribah’s own');
  assert.equal(embedRefsOf(pairing('https://evil.example/embed/try-on?store=ward&product=sa-1001')), null, 'another site');
  assert.equal(embedRefsOf(pairing('https://tajribah.sa/embed/try-on?store=bad%20key&product=sa-1001')), null, 'a key that cannot name a config');
  assert.equal(embedRefsOf(pairing(null)), null);
  assert.equal(embedRefsOf(pairing('not a url')), null);

  const asked: string[] = [];
  const host = (answer: () => Response) => (async (url: string | URL | Request) => { asked.push(String(url)); return answer(); }) as typeof fetch;
  const withBrand = () => Response.json({ v: 1, brand: { name: 'Maison Ward', nameAr: 'ميزون وارد', logo: null } });
  assert.deepEqual(await brandOfPairing(pairing('https://tajribah.sa/embed/try-on?store=ward&product=sa-1001'), host(withBrand)), { name: { ar: 'ميزون وارد', en: 'Maison Ward' }, logo: null });
  assert.equal(asked.at(-1), `${CONFIG_BASE}/ward/sa-1001.json`);
  await brandOfPairing(pairing('https://tajribah.sa/embed/try-on?store=ward&product=sa-1001&base=http://localhost:9000'), host(withBrand));
  assert.equal(asked.at(-1), `${CONFIG_BASE}/ward/sa-1001.json`, 'a public page never reads another config host');
  await brandOfPairing(pairing('http://localhost:3000/embed/try-on?store=ward&product=sa-1001&base=http://localhost:9000', 'http://localhost:3000/api/pair'), host(withBrand));
  assert.equal(asked.at(-1), 'http://localhost:9000/ward/sa-1001.json', 'a test on this machine may');

  const count = asked.length;
  assert.equal(await brandOfPairing(pairing('https://tajribah.sa/demo'), host(withBrand)), null);
  assert.equal(asked.length, count, 'nothing is fetched for a pairing outside the frame');
  assert.equal(await brandOfPairing(pairing('https://tajribah.sa/embed/try-on?store=ward&product=sa-1001'), host(() => Response.json({ v: 1 }))), null, 'no brand (not Enterprise)');
  assert.equal(await brandOfPairing(pairing('https://tajribah.sa/embed/try-on?store=ward&product=sa-1001'), host(() => new Response('', { status: 404 }))), null);
  assert.equal(await brandOfPairing(pairing('https://tajribah.sa/embed/try-on?store=ward&product=sa-1001'), (async () => { throw new Error('down'); }) as typeof fetch), null, 'the host unreachable: Tajribah’s, and the pairing still works');
});
