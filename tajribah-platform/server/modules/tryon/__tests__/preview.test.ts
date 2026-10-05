/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T85 — any product's try-on as a shopper sees it, in the dashboard: tried as what it is, as a guess from
 * its category, or as the merchant picks; its cut-out or its store picture; its size or the example's —
 * and what comes out is what the shop's frame reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { categories, products, subscriptions } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { WIDTH_MM, type TryOnKind } from '@/lib/tryon';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, forTenant, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import { confirmCutout, startCutoutUpload, storePhoto, tryOnOne, updateTryOn } from '@/server/modules/tryon/service';
import { EXAMPLE_MM, guessKind, tryOnPreview } from '@/server/modules/tryon/preview';
import { tryOnProductFrom } from '@site/lib/tryon-config';
import { pageCsp } from '@site/lib/security';
import { DEMO_RING } from '@site/lib/demo-product';

setLogLevel('error');
const FRAME = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'assets', 'glasses-front.png')));
class CdnStorage extends MemoryStorage { publicUrl(k: string) { return `https://cdn.example.test/${k}`; } }

async function store(harness: TestDb, name: string, plan: 'pro' | 'starter' = 'pro') {
  setStorage(new CdnStorage());
  const seeded = await seedTenant(harness, name);
  const planId = await seededPlanId(harness, plan);
  const now = new Date();
  await harness.asAdmin(() => harness.db.insert(subscriptions).values({ id: uuidv7(), tenantId: seeded.tenantId, planId, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) } as any));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const add = async (values: Record<string, unknown>) => {
    const id = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id, tenantId: seeded.tenantId, externalId: id, ...values } as any));
    return id;
  };
  return { ...seeded, ctx, add };
}

test('a product from a feed, no try-on set: guessed from its category, its store picture, the example’s size — and the frame reads it', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, add } = await store(harness, 'feed');
    const rings = uuidv7();
    await harness.asAdmin(() => harness.db.insert(categories).values({ id: rings, tenantId, name: 'خواتم نسائية', slug: 'rings' } as any));
    const id = await add({ name: 'Zircon silver', nameAr: 'فضي زركون', productType: 'jewelry', categoryId: rings, images: [{ url: 'http://insecure.example.test/a.jpg' }, { url: 'https://shop.example.test/ring.jpg' }] });

    const seen = await tryOnPreview(ctx, id, null);
    assert.deepEqual([seen.kind, seen.own, seen.guessed, seen.picture], ['ring', null, true, 'store']);
    assert.deepEqual(seen.size, { mm: DEMO_RING.caseMm, from: 'example' }, 'no size: the example ring’s, said as such');
    assert.equal(seen.onMe, true, 'Pro: the shopper’s own photo too');
    const studio = tryOnProductFrom(seen.config);
    assert.ok(studio, 'what the shop’s frame reads');
    assert.deepEqual([studio.category, studio.caseMm, studio.worn, studio.flat, studio.onMe], ['ring', DEMO_RING.caseMm, 'https://shop.example.test/ring.jpg', 'https://shop.example.test/ring.jpg', true], 'https pictures only');

    const asWatch = await tryOnPreview(ctx, id, 'watch');
    assert.deepEqual([asWatch.kind, asWatch.guessed, asWatch.size?.mm], ['watch', false, EXAMPLE_MM.watch], 'the merchant’s choice, not a guess');
    assert.equal(tryOnProductFrom(asWatch.config)?.category, undefined, 'a watch has no category');

    const sized = await add({ name: 'Signet', productType: 'other', dimensions: { widthMm: 18 }, images: [{ url: 'https://shop.example.test/s.jpg' }] });
    assert.deepEqual((await tryOnPreview(ctx, sized, 'ring')).size, { mm: 18, from: 'product' }, 'its own width, when it fits a ring');
    assert.deepEqual((await tryOnPreview(ctx, sized, 'bag')).size?.from, 'example', '18 mm is no bag: the example’s');

    const bare = await add({ name: 'No picture', productType: 'watch' });
    const none = await tryOnPreview(ctx, bare, null);
    assert.deepEqual([none.kind, none.picture, none.config], ['watch', null, null], 'nothing to draw: no settings for the frame');

    const unknown = await add({ name: 'Scarf', productType: 'other', images: [{ url: 'https://shop.example.test/x.jpg' }] });
    assert.deepEqual(await tryOnPreview(ctx, unknown, null), { kind: null, own: null, guessed: false, picture: null, size: null, config: null, onMe: true }, 'nothing says what it is: the merchant chooses');

    const { ctx: other } = await store(harness, 'other-store', 'starter');
    await assert.rejects(() => tryOnPreview(other, id, null), (e: any) => e.status === 404, 'another store’s product is not found');
  } finally {
    await harness.close();
  }
});

test('glasses set up with a cut-out: its picture and width; tried as something else, the settings stay with the glasses', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, add } = await store(harness, 'optic', 'starter');
    const id = await add({ name: 'Round frame', productType: 'eyewear', images: [{ url: 'https://shop.example.test/frame.jpg' }] });
    const started = await startCutoutUpload(ctx, id, { slot: 'worn', filename: 'frame.png', contentType: 'image/png', sizeBytes: FRAME.length });
    await forTenant(ctx.tenantId).put(started.key, FRAME.slice().buffer as ArrayBuffer);
    await confirmCutout(ctx, id, { slot: 'worn', key: started.key });
    await updateTryOn(ctx, id, { caseMm: 132 });

    const seen = await tryOnPreview(ctx, id, null);
    assert.deepEqual([seen.kind, seen.own, seen.guessed, seen.picture, seen.size?.from, seen.size?.mm], ['glasses', 'glasses', false, 'cutout', 'settings', 132]);
    assert.equal(seen.onMe, false, 'Starter: on the model and in the comparison only');
    const studio = tryOnProductFrom(seen.config)!;
    assert.deepEqual([studio.category, studio.worn.startsWith('https://cdn.example.test/'), studio.onMe], ['eyewear', true, false], 'not published, not switched on — the preview still shows it');

    const asBag = await tryOnPreview(ctx, id, 'bag');
    assert.deepEqual([asBag.picture, asBag.size?.from, tryOnProductFrom(asBag.config)?.worn], ['store', 'example', 'https://shop.example.test/frame.jpg'], 'a frame’s cut-out and width are not a bag’s');
  } finally {
    await harness.close();
  }
});

test('a kind from words: categories and names in Arabic and English; a word that could be anything names nothing', () => {
  const cases: [string, TryOnKind | null][] = [
    ['خواتم نسائية', 'ring'], ['تعليقة مع حلق', 'earring'], ['سلاسل', 'necklace'], ['تشوكر', 'necklace'],
    ['ساعات رجالية', 'watch'], ['نظارات شمسية', 'glasses'], ['حقائب يد', 'bag'], ['Apparel > Jewelry > Rings', 'ring'],
    ['Gold earrings', 'earring'], ['أساور نسائية', null], ['إكسسوارات', null], ['أطقم', null], ['', null],
  ];
  for (const [text, kind] of cases) assert.equal(guessKind([text]), kind, text);
  assert.equal(guessKind([null, 'أطقم', 'خاتم فضي']), 'ring', 'the category first, then the name');
  for (const kind of Object.keys(EXAMPLE_MM) as TryOnKind[]) assert.ok(EXAMPLE_MM[kind] >= WIDTH_MM[kind].min && EXAMPLE_MM[kind] <= WIDTH_MM[kind].max, kind);
});

test('the try-on page may be framed by the dashboard on this same address; other pages by no one', () => {
  const framed = pageCsp('n', { framed: true });
  assert.match(framed, /frame-ancestors 'self' https:/);
  assert.match(pageCsp('n'), /frame-ancestors 'none'/);
});

test('T87 one product’s try-on settings; T88 its own store picture, as it is, for the browser to clear', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, add } = await store(harness, 'one');
    const watch = await add({ name: 'Diver', productType: 'watch', images: [{ url: 'https://shop.example.test/w.jpg' }] });
    const bracelet = await add({ name: 'Bangle', productType: 'jewelry' });
    const scarf = await add({ name: 'Scarf', productType: 'other' });
    const one = await tryOnOne(ctx, watch);
    assert.deepEqual([one.product.id, one.watches.map((w) => w.productId), one.jewelry.length], [watch, [watch], 0], 'that product only');
    assert.deepEqual([(await tryOnOne(ctx, bracelet)).watches.length, (await tryOnOne(ctx, bracelet)).jewelry.map((j) => j.productId)], [0, [bracelet]], 'jewelry not marked: to be marked');
    const other = await tryOnOne(ctx, scarf);
    assert.deepEqual([other.watches.length, other.jewelry.length], [0, 0], 'a type that is not tried on: neither');

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const fetches: string[] = [];
    const fake = (async (url: string) => { fetches.push(String(url)); return new Response(jpeg, { status: 200 }); }) as unknown as typeof fetch;
    const resolve = async () => ['93.184.216.34'];
    const photo = await storePhoto(ctx, watch, 'https://shop.example.test/w.jpg', fake, resolve);
    assert.deepEqual([photo.contentType, photo.bytes.length], ['image/jpeg', jpeg.length], 'a JPEG is fine here: the browser makes the cut-out');
    await assert.rejects(() => storePhoto(ctx, watch, 'https://elsewhere.example.test/x.jpg', fake, resolve), (e: any) => !!e.errors?.url, 'only its own store pictures');
    await assert.rejects(() => storePhoto(ctx, watch, 'https://shop.example.test/w.jpg', fake, async () => ['10.0.0.5']), (e: any) => !!e.errors?.url, 'never a private address');
    assert.deepEqual(fetches, ['https://shop.example.test/w.jpg'], 'nothing else fetched');
  } finally {
    await harness.close();
  }
});
