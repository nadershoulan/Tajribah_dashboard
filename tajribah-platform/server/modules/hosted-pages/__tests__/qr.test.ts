/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P1.20 — QR codes: one per product whose own page is live, opening that page tagged `?s=qr` (the
 * website counts it as a visit from a code). A printed code is permanent, so the screen offers printing
 * only once the address is final — the short domain in HOSTED_PAGE_BASE, or the store's own address —
 * and never on Tajribah's default or a local address.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { customDomains, models3d, modelFiles, modelVersions, products, tenants } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { publishProduct, unpublishProduct } from '@/server/modules/edge/publish';
import { saveHostedPage } from '@/server/modules/hosted-pages/service';
import { qrCodesFor } from '@/server/modules/hosted-pages/qr';
import { viaOf } from '@site/lib/page-events';

setLogLevel('error');
const ENV = { APP_URL: 'http://localhost:5173', AUTH_SECRET: 'a'.repeat(40), ENCRYPTION_KEY: 'b'.repeat(40) };

class CdnStorage extends MemoryStorage {
  publicUrl(k: string) { return `https://cdn.example.test/${k}`; }
}

async function store(harness: TestDb, name: string, plan: 'starter' | 'enterprise', env: Record<string, string> = {}) {
  resetEnv();
  loadEnv({ ...ENV, ...env });
  setStorage(new CdnStorage());
  setConfigStore(new MemoryConfigStore());
  const seeded = await seedTenant(harness, name, { plan });
  await harness.asAdmin(() => harness.db.update(tenants).set({ name: 'Oud House' } as any).where(eq(tenants.id, seeded.tenantId)));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

/** A product with a live 3D model, ready to publish. */
async function lamp(harness: TestDb, tenantId: string, externalId: string, name: string) {
  const [row] = (await harness.asAdmin(() => harness.db.insert(products).values({
    tenantId, name, nameAr: `${name} (ع)`, productType: 'other', externalId, arEnabled: true, dimensions: { widthMm: 420, heightMm: 1650 },
  } as any).returning())) as any[];
  const modelId = uuidv7();
  const versionId = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(models3d).values({ id: modelId, tenantId, productId: row.id, name, source: 'uploaded', status: 'ready', currentVersionId: versionId } as any);
    await harness.db.insert(modelVersions).values({ id: versionId, tenantId, modelId, version: 1, status: 'ready' } as any);
    await harness.db.insert(modelFiles).values({ id: uuidv7(), tenantId, modelVersionId: versionId, format: 'glb', variant: 'optimized', compression: 'meshopt', storageKey: `t/${tenantId}/model/${modelId}/v1/optimized.glb` } as any);
  });
  return row;
}

test('a code per live product page, tagged as from a QR code; a page switched off or a product taken down has none', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'oud', 'starter');
    assert.deepEqual(await qrCodesFor(ctx), { included: true, printable: false, testOnly: false, base: 'https://tajribah.com/p', products: [] }, 'nothing published: no codes');

    const arc = await lamp(harness, tenantId, 'sa-77', 'Arc lamp');
    const bowl = await lamp(harness, tenantId, 'sa 9/1', 'Brass bowl');
    await lamp(harness, tenantId, 'sa-3', 'Never published');
    await publishProduct(ctx, arc.id);
    await publishProduct(ctx, bowl.id);

    const screen = await qrCodesFor(ctx);
    assert.deepEqual(screen.products.map((p) => [p.name, p.url]), [
      ['Arc lamp', 'https://tajribah.com/p/oud/sa-77?s=qr'],
      ['Brass bowl', 'https://tajribah.com/p/oud/sa%209%2F1?s=qr'],
    ], 'the page’s own address, the product reference encoded as the page reads it');
    assert.equal(screen.products[0]!.nameAr, 'Arc lamp (ع)');
    assert.equal(viaOf(new URL(screen.products[0]!.url).search), 'qr', 'the website counts the visit as from a code');
    assert.equal(screen.printable, false, 'Tajribah’s default address is not final: previews only');

    await saveHostedPage(ctx, bowl.id, { active: false, shopUrl: null });
    await unpublishProduct(ctx, arc.id);
    assert.deepEqual((await qrCodesFor(ctx)).products, [], 'switched off, taken down: no code to print');
  } finally { await harness.close(); }
});

test('printable only on a final address: the short domain once set, or the store’s own address — never the default or a local one', async () => {
  const harness = await createTestDb();
  try {
    {
      const { ctx, tenantId } = await store(harness, 'short', 'starter', { HOSTED_PAGE_BASE: 'https://tjr.sa' });
      await publishProduct(ctx, (await lamp(harness, tenantId, 'sa-1', 'Lamp')).id);
      const screen = await qrCodesFor(ctx);
      assert.equal(screen.printable, true);
      assert.equal(screen.products[0]!.url, 'https://tjr.sa/short/sa-1?s=qr', 'the short domain carries it');
    }
    {
      const { ctx } = await store(harness, 'local', 'starter', { HOSTED_PAGE_BASE: 'http://localhost:5173/p' });
      assert.equal((await qrCodesFor(ctx)).printable, false, 'a test address on this machine is never printed');
      assert.equal((await qrCodesFor(ctx)).testOnly, true, 'but a phone on the network may scan it, to test');
    }
    {
      const { ctx } = await store(harness, 'wifi', 'starter', { HOSTED_PAGE_BASE: 'http://192.168.1.20:8799/p' });
      const screen = await qrCodesFor(ctx);
      assert.deepEqual([screen.printable, screen.testOnly], [false, true], 'T82: this computer’s Wi-Fi address — test only, never printed');
    }
    {
      const { ctx } = await store(harness, 'same', 'starter', { HOSTED_PAGE_BASE: 'https://tajribah.com/p' });
      assert.equal((await qrCodesFor(ctx)).printable, false, 'the default, written out, is still the default');
      assert.equal((await qrCodesFor(ctx)).testOnly, false, 'the default is not this computer');
    }
    {
      const { ctx, tenantId } = await store(harness, 'own', 'enterprise');
      await harness.asAdmin(() => harness.db.insert(customDomains).values({ id: uuidv7(), tenantId, hostname: 'ar.oud.sa', token: 't'.repeat(32), status: 'active' } as any));
      await publishProduct(ctx, (await lamp(harness, tenantId, 'sa-2', 'Lamp')).id);
      const screen = await qrCodesFor(ctx);
      assert.deepEqual([screen.printable, screen.base, screen.products[0]!.url], [true, 'https://ar.oud.sa/p', 'https://ar.oud.sa/p/own/sa-2?s=qr'], 'the store’s own address is its own to keep');
    }
  } finally { await harness.close(); }
});
