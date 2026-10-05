/* eslint-disable @typescript-eslint/no-explicit-any */
/** T80: one of the product's own store pictures as its try-on picture — fetched safely, checked like an upload. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { products, tryonConfigs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { cutoutFromStorePicture } from '@/server/modules/tryon/service';
import { pictureFormat } from '@/server/modules/tryon/store-picture';

setLogLevel('error');
const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'server/modules/tryon/__tests__/fixtures', name)));
const CDN = 'https://cdn.salla.sa/NeaeB/';
const PICTURES: Record<string, Uint8Array> = { 'worn.png': fixture('worn.png'), 'photo.jpg': fixture('photo.jpg'), 'flat.png': fixture('flat.png'), 'opaque.png': fixture('worn-no-alpha.png') };

/** The store's CDN as the reader sees it: public addresses, and the pictures. */
const store = (address = '93.184.216.34') => {
  const asked: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const name = url.startsWith(CDN) ? url.slice(CDN.length) : '';
    return PICTURES[name] ? new Response(PICTURES[name].slice().buffer as ArrayBuffer) : new Response('no', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, resolve: async () => [address], asked };
};

async function shop(harness: TestDb) {
  setStorage(new MemoryStorage());
  const seeded = await seedTenant(harness, 'failet');
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const watch = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values({
    id: watch, tenantId: seeded.tenantId, name: 'ساعة نسائية', productType: 'watch',
    images: ['worn.png', 'photo.jpg', 'flat.png', 'opaque.png'].map((n) => ({ url: CDN + n })),
  } as any));
  return { ...seeded, ctx, watch };
}

test('a cut-out store picture becomes the try-on picture, checked like an upload', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, tenantId } = await shop(harness);
    const cdn = store();
    const view = await cutoutFromStorePicture(ctx, watch, { slot: 'worn', url: CDN + 'worn.png' }, cdn.fetchImpl, cdn.resolve);
    assert.deepEqual([!!view.worn, view.missing], [true, ['flat', 'case']]);
    assert.deepEqual(view.storePictures, ['worn.png', 'photo.jpg', 'flat.png', 'opaque.png'].map((n) => CDN + n), 'the screen offers the product’s pictures');
    await cutoutFromStorePicture(ctx, watch, { slot: 'flat', url: CDN + 'flat.png' }, cdn.fetchImpl, cdn.resolve);
    const [row] = await harness.asAdmin(() => harness.db.select().from(tryonConfigs).where(eq(tryonConfigs.productId, watch))) as any[];
    assert.match(row.wornKey, new RegExp(`^t/${tenantId}/photo/[0-9a-f-]{36}/worn\.png$`), 'stored as an upload would be');
    assert.ok(row.flatKey);
  } finally { await harness.close(); }
});

test('refused, with the reason: a JPEG, a picture that is not cut out, one that is not this product’s, a private address', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch } = await shop(harness);
    const cdn = store();
    const reason = (e: any) => JSON.stringify(e.errors ?? e.message);
    await assert.rejects(() => cutoutFromStorePicture(ctx, watch, { slot: 'worn', url: CDN + 'photo.jpg' }, cdn.fetchImpl, cdn.resolve), (e: any) => /JPEG/.test(reason(e)));
    await assert.rejects(() => cutoutFromStorePicture(ctx, watch, { slot: 'worn', url: CDN + 'opaque.png' }, cdn.fetchImpl, cdn.resolve), (e: any) => e.code === 'validation_failed' && /transparen/i.test(reason(e)), 'the upload check’s own words');
    const before = cdn.asked.length;
    await assert.rejects(() => cutoutFromStorePicture(ctx, watch, { slot: 'worn', url: 'https://evil.example/x.png' }, cdn.fetchImpl, cdn.resolve), (e: any) => /not one of this product/.test(reason(e)));
    assert.equal(cdn.asked.length, before, 'an address of the caller’s choosing is never fetched');
    const lan = store('10.0.0.5');
    await assert.rejects(() => cutoutFromStorePicture(ctx, watch, { slot: 'worn', url: CDN + 'worn.png' }, lan.fetchImpl, lan.resolve), (e: any) => /private network/.test(reason(e)));
    assert.equal(lan.asked.length, 0, 'a private address is not opened');
    const [row] = await harness.asAdmin(() => harness.db.select().from(tryonConfigs).where(eq(tryonConfigs.productId, watch))) as any[];
    assert.equal(row?.wornKey ?? null, null, 'nothing attached');
  } finally { await harness.close(); }
});

test('the format is read from the bytes, not the address', () => {
  assert.equal(pictureFormat(fixture('worn.png')), 'png');
  assert.equal(pictureFormat(fixture('worn.webp')), 'webp');
  assert.equal(pictureFormat(fixture('photo.jpg')), 'jpeg');
  assert.equal(pictureFormat(new TextEncoder().encode('<html>')), null);
});
