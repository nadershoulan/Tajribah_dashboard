/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P5.2 (T68) — glasses set up by a merchant: an Eyewear product takes one picture (the frame from the
 * front, the website demo's real cut-out here) and the frame's width; it publishes with
 * `category: 'glasses'` on the face placement, the one picture as both; the widget and the try-on
 * page read it as glasses, and the width ranges are the same on all three sides.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { products, subscriptions } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { WIDTH_MM } from '@/lib/tryon';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, forTenant, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import { publishProduct } from '@/server/modules/edge/publish';
import { confirmCutout, startCutoutUpload, tryOnScreen, updateTryOn } from '@/server/modules/tryon/service';
import { TRYON_WIDTH_MM, parseConfig } from '../../../../widget/src/config';
import { tryOnProductFrom } from '@site/lib/tryon-config';

setLogLevel('error');
const FRAME = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'assets', 'glasses-front.png')));
const RING = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'assets', 'ring-top.webp')));
const NECKLACE = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'assets', 'necklace-front.webp')));
const EARRING = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'assets', 'earring-front.webp')));
const BAG = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'assets', 'bag-front.webp')));
class CdnStorage extends MemoryStorage { publicUrl(k: string) { return `https://cdn.example.test/${k}`; } }

async function store(harness: TestDb, name: string) {
  setStorage(new CdnStorage());
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  const seeded = await seedTenant(harness, name);
  const planId = await seededPlanId(harness, 'pro');
  const now = new Date();
  await harness.asAdmin(() => harness.db.insert(subscriptions).values({ id: uuidv7(), tenantId: seeded.tenantId, planId, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) } as any));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const glasses = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values({ id: glasses, tenantId: seeded.tenantId, name: 'Round frame', nameAr: 'إطار دائري', sku: 'RF-1', productType: 'eyewear', externalId: 'rf-1' } as any));
  return { ...seeded, ctx, glasses, kv };
}

test('an Eyewear product: one picture, the frame’s width, then on the shop as glasses', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, glasses, kv } = await store(harness, 'optic');
    const listed = (await tryOnScreen(ctx)).watches.find((w) => w.productId === glasses)!;
    assert.equal(listed.kind, 'glasses');
    assert.deepEqual(listed.missing, ['worn', 'case'], 'one picture, no product shot');
    await assert.rejects(() => startCutoutUpload(ctx, glasses, { slot: 'flat', filename: 'f.png', contentType: 'image/png', sizeBytes: FRAME.length }), (e: any) => !!e.errors?.slot, 'glasses take one picture');

    const started = await startCutoutUpload(ctx, glasses, { slot: 'worn', filename: 'frame.png', contentType: 'image/png', sizeBytes: FRAME.length });
    await forTenant(ctx.tenantId).put(started.key, FRAME.slice().buffer as ArrayBuffer);
    await confirmCutout(ctx, glasses, { slot: 'worn', key: started.key });
    await assert.rejects(() => updateTryOn(ctx, glasses, { caseMm: 38 }), (e: any) => !!e.errors?.caseMm, 'a watch’s width is not a frame’s');
    await assert.rejects(() => updateTryOn(ctx, glasses, { caseMm: 200 }), (e: any) => !!e.errors?.caseMm);
    const ready = await updateTryOn(ctx, glasses, { caseMm: 132, enabled: true });
    assert.deepEqual([ready.ready, ready.enabled, ready.caseMm], [true, true, 132]);

    await publishProduct(ctx, glasses);
    const [entry] = [...kv.entries.values()];
    const config = JSON.parse(entry!.body);
    assert.equal(config.placement, 'face');
    assert.equal(config.model, null, 'no 3D model needed: the button opens the studio');
    assert.equal(config.tryon.category, 'glasses');
    assert.equal(config.tryon.worn, config.tryon.flat, 'the one picture, as both');
    assert.equal(config.tryon.caseMm, 132);

    const widget = parseConfig(config);
    assert.ok(widget?.tryon, 'the widget opens the studio for it');
    assert.equal(widget!.tryon!.category, 'glasses');
    const studio = tryOnProductFrom(config);
    assert.equal(studio?.category, 'eyewear', 'the try-on page hands the studio glasses');
    assert.equal(studio?.onMe, true, 'on Pro, the shopper’s own photo too — the face is found on their device');
  } finally { await harness.close(); }
});

test('the parsers agree on what each kind may be, and refuse a mix', () => {
  assert.deepEqual([...TRYON_WIDTH_MM.watch], [WIDTH_MM.watch.min, WIDTH_MM.watch.max]);
  assert.deepEqual([...TRYON_WIDTH_MM.glasses], [WIDTH_MM.glasses.min, WIDTH_MM.glasses.max]);
  const base = {
    v: 1, product: { name: 'X', nameAr: null, widthMm: null, heightMm: null }, model: null,
    button: { labelAr: 'جرّبها', labelEn: 'Try it', color: '#0A2237', radius: 8, variant: 'solid', icon: true },
    scale: 1, autoRotate: false, shadow: 1, host: null,
  };
  const tryon = (over: object) => ({ worn: 'https://cdn.example.test/a.png', flat: 'https://cdn.example.test/a.png', caseMm: 132, sku: null, onMe: false, category: 'glasses', ...over });
  assert.ok(parseConfig({ ...base, placement: 'face', tryon: tryon({}) }));
  assert.equal(parseConfig({ ...base, placement: 'wrist', tryon: tryon({}) }), null, 'glasses on a wrist: nothing to open');
  assert.equal(parseConfig({ ...base, placement: 'face', tryon: tryon({ caseMm: 38 }) }), null, 'a watch-sized frame');
  assert.equal(parseConfig({ ...base, placement: 'face', tryon: tryon({ category: 'ring' }) }), null, 'a kind this widget does not know');
  assert.ok(parseConfig({ ...base, placement: 'wrist', tryon: tryon({ category: undefined, caseMm: 38 }) }), 'a watch as before');
  for (const [caseMm, ok] of [[99, false], [100, true], [170, true], [171, false]] as const) {
    const config = { ...base, placement: 'face', tryon: tryon({ caseMm }) };
    assert.equal(!!parseConfig(config), ok, `widget ${caseMm}`);
    assert.equal(!!tryOnProductFrom(config), ok, `try-on page ${caseMm}`);
  }
});

test('P5.4 a Jewelry product the merchant marks as a ring: one picture, 14–30 mm, on the shop as a ring on the hand', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv, glasses } = await store(harness, 'gold');
    const ring = uuidv7();
    const earrings = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values([
      { id: ring, tenantId, name: 'Two-stone ring', productType: 'jewelry', externalId: 'ring-2' },
      { id: earrings, tenantId, name: 'Pearl earrings', productType: 'jewelry' },
    ] as any));
    const before = await tryOnScreen(ctx);
    assert.deepEqual(before.jewelry.map((j) => j.productId).sort(), [ring, earrings].sort(), 'jewelry waits to be told which are rings');
    assert.ok(!before.watches.some((w) => w.productId === ring));
    await assert.rejects(() => startCutoutUpload(ctx, ring, { slot: 'worn', filename: 'r.webp', contentType: 'image/webp', sizeBytes: RING.length }), (e: any) => e.code === 'conflict' && /a ring, a necklace or an earring first/.test(e.message));
    await updateTryOn(ctx, ring, { jewelry: 'ring' });
    await assert.rejects(() => updateTryOn(ctx, glasses, { jewelry: 'ring' }), (e: any) => e.code === 'conflict', 'only jewelry');
    const after = await tryOnScreen(ctx);
    assert.deepEqual(after.jewelry.map((j) => j.productId), [earrings], 'earrings stay where they were');
    const listed = after.watches.find((w) => w.productId === ring)!;
    assert.equal(listed.kind, 'ring');
    assert.deepEqual(listed.missing, ['worn', 'case']);
    const started = await startCutoutUpload(ctx, ring, { slot: 'worn', filename: 'ring.webp', contentType: 'image/webp', sizeBytes: RING.length });
    await forTenant(tenantId).put(started.key, RING.slice().buffer as ArrayBuffer);
    await confirmCutout(ctx, ring, { slot: 'worn', key: started.key });
    await assert.rejects(() => updateTryOn(ctx, ring, { jewelry: null }), (e: any) => e.code === 'conflict', 'not taken back once it has a picture');
    await assert.rejects(() => updateTryOn(ctx, ring, { caseMm: 38 }), (e: any) => !!e.errors?.caseMm, 'a watch-sized ring');
    const ready = await updateTryOn(ctx, ring, { caseMm: 20.5, enabled: true });
    assert.deepEqual([ready.ready, ready.enabled], [true, true]);
    await publishProduct(ctx, ring);
    const config = JSON.parse([...kv.entries.values()].find((e) => e.body.includes('ring-2') || e.body.includes('Two-stone'))!.body);
    assert.deepEqual([config.placement, config.tryon.category, config.tryon.caseMm, config.tryon.worn === config.tryon.flat], ['wrist', 'ring', 20.5, true]);
    assert.equal(parseConfig(config)?.tryon?.category, 'ring');
    const studio = tryOnProductFrom(config);
    assert.deepEqual([studio?.category, studio?.onMe], ['ring', true], 'on Pro, the shopper’s own hand photo too');
  } finally { await harness.close(); }
});

test('P5.4 the ring range is the same on all sides, and a ring is never on a face', () => {
  assert.deepEqual([...TRYON_WIDTH_MM.ring], [WIDTH_MM.ring.min, WIDTH_MM.ring.max]);
  const base = {
    v: 1, product: { name: 'X', nameAr: null, widthMm: null, heightMm: null }, model: null,
    button: { labelAr: 'جرّبها', labelEn: 'Try it', color: '#0A2237', radius: 8, variant: 'solid', icon: true },
    scale: 1, autoRotate: false, shadow: 1, host: null,
  };
  const tryon = (caseMm: number) => ({ category: 'ring', worn: 'https://cdn.example.test/r.webp', flat: 'https://cdn.example.test/r.webp', caseMm, sku: null, onMe: false });
  assert.equal(parseConfig({ ...base, placement: 'face', tryon: tryon(20) }), null);
  for (const [caseMm, ok] of [[13, false], [14, true], [30, true], [31, false]] as const) {
    const config = { ...base, placement: 'wrist', tryon: tryon(caseMm) };
    assert.equal(!!parseConfig(config), ok, `widget ${caseMm}`);
    assert.equal(!!tryOnProductFrom(config), ok, `try-on page ${caseMm}`);
  }
});

test('P5.5 a Jewelry product marked as a necklace: one picture, 60–300 mm, on the shop as a necklace', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'pearl');
    const necklace = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: necklace, tenantId, name: 'Gold pendant necklace', productType: 'jewelry', externalId: 'neck-3' } as any));
    await updateTryOn(ctx, necklace, { jewelry: 'necklace' });
    const listed = (await tryOnScreen(ctx)).watches.find((w) => w.productId === necklace)!;
    assert.deepEqual([listed.kind, listed.missing], ['necklace', ['worn', 'case']]);
    const started = await startCutoutUpload(ctx, necklace, { slot: 'worn', filename: 'n.webp', contentType: 'image/webp', sizeBytes: NECKLACE.length });
    await forTenant(tenantId).put(started.key, NECKLACE.slice().buffer as ArrayBuffer);
    await confirmCutout(ctx, necklace, { slot: 'worn', key: started.key });
    await assert.rejects(() => updateTryOn(ctx, necklace, { jewelry: 'ring' }), (e: any) => e.code === 'conflict', 'not switched to a ring once it has a picture');
    await assert.rejects(() => updateTryOn(ctx, necklace, { caseMm: 20 }), (e: any) => !!e.errors?.caseMm, 'a ring-sized necklace');
    await updateTryOn(ctx, necklace, { caseMm: 170, enabled: true });
    await publishProduct(ctx, necklace);
    const config = JSON.parse([...kv.entries.values()].find((e) => e.body.includes('Gold pendant'))!.body);
    assert.deepEqual([config.placement, config.tryon.category, config.tryon.caseMm], ['wrist', 'necklace', 170]);
    assert.equal(parseConfig(config)?.tryon?.category, 'necklace');
    assert.deepEqual([tryOnProductFrom(config)?.category, tryOnProductFrom(config)?.onMe], ['necklace', true], 'on Pro, the shopper’s own photo too');
    assert.deepEqual([...TRYON_WIDTH_MM.necklace], [WIDTH_MM.necklace.min, WIDTH_MM.necklace.max]);
    for (const [caseMm, ok] of [[59, false], [60, true], [300, true], [301, false]] as const) {
      const c = { ...config, tryon: { ...config.tryon, caseMm } };
      assert.equal(!!parseConfig(c), ok, `widget ${caseMm}`);
      assert.equal(!!tryOnProductFrom(c), ok, `try-on page ${caseMm}`);
    }
  } finally { await harness.close(); }
});

test('P5.5 a Jewelry product marked as an earring: one picture, 5–60 mm, on the shop as an earring — on the model and in the comparison', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'hoop');
    const earring = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: earring, tenantId, name: 'Gold huggie hoop', productType: 'jewelry', externalId: 'ear-6' } as any));
    await updateTryOn(ctx, earring, { jewelry: 'earring' });
    const listed = (await tryOnScreen(ctx)).watches.find((w) => w.productId === earring)!;
    assert.deepEqual([listed.kind, listed.missing], ['earring', ['worn', 'case']]);
    const started = await startCutoutUpload(ctx, earring, { slot: 'worn', filename: 'e.webp', contentType: 'image/webp', sizeBytes: EARRING.length });
    await forTenant(tenantId).put(started.key, EARRING.slice().buffer as ArrayBuffer);
    await confirmCutout(ctx, earring, { slot: 'worn', key: started.key });
    await assert.rejects(() => updateTryOn(ctx, earring, { jewelry: 'necklace' }), (e: any) => e.code === 'conflict', 'not switched once it has a picture');
    await assert.rejects(() => updateTryOn(ctx, earring, { caseMm: 170 }), (e: any) => !!e.errors?.caseMm, 'a necklace-sized earring');
    await updateTryOn(ctx, earring, { caseMm: 10.6, enabled: true });
    await publishProduct(ctx, earring);
    const config = JSON.parse([...kv.entries.values()].find((e) => e.body.includes('Gold huggie'))!.body);
    assert.deepEqual([config.placement, config.tryon.category, config.tryon.caseMm], ['wrist', 'earring', 10.6]);
    assert.equal(parseConfig(config)?.tryon?.category, 'earring');
    assert.deepEqual([tryOnProductFrom(config)?.category, tryOnProductFrom(config)?.onMe], ['earring', true], 'on the model, in the comparison, and (T83) on the shopper’s own photo — the plan allows it');
    assert.deepEqual([...TRYON_WIDTH_MM.earring], [WIDTH_MM.earring.min, WIDTH_MM.earring.max]);
    for (const [caseMm, ok] of [[4.9, false], [5, true], [60, true], [60.1, false]] as const) {
      const c = { ...config, tryon: { ...config.tryon, caseMm } };
      assert.equal(!!parseConfig(c), ok, `widget ${caseMm}`);
      assert.equal(!!tryOnProductFrom(c), ok, `try-on page ${caseMm}`);
    }
  } finally { await harness.close(); }
});

test('P5.6 a Bag product: one picture, 100–600 mm, on the shop as a bag — wherever a bag’s button goes, never on a wrist or face', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'leather');
    const bag = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: bag, tenantId, name: 'Embroidered handbag', productType: 'bag', externalId: 'bag-5' } as any));
    const listed = (await tryOnScreen(ctx)).watches.find((w) => w.productId === bag)!;
    assert.deepEqual([listed.kind, listed.missing], ['bag', ['worn', 'case']], 'no marking needed: the product type says it');
    const started = await startCutoutUpload(ctx, bag, { slot: 'worn', filename: 'b.webp', contentType: 'image/webp', sizeBytes: BAG.length });
    await forTenant(tenantId).put(started.key, BAG.slice().buffer as ArrayBuffer);
    await confirmCutout(ctx, bag, { slot: 'worn', key: started.key });
    await assert.rejects(() => updateTryOn(ctx, bag, { caseMm: 50 }), (e: any) => !!e.errors?.caseMm);
    await updateTryOn(ctx, bag, { caseMm: 280, enabled: true });
    await publishProduct(ctx, bag);
    const config = JSON.parse([...kv.entries.values()].find((e) => e.body.includes('Embroidered handbag'))!.body);
    assert.equal(config.tryon.category, 'bag');
    assert.ok(config.placement !== 'face' && config.placement !== 'wrist', config.placement);
    assert.equal(parseConfig(config)?.tryon?.category, 'bag');
    assert.equal(parseConfig({ ...config, placement: 'wrist' }), null, 'a bag on a wrist: nothing to open');
    assert.deepEqual([tryOnProductFrom(config)?.category, tryOnProductFrom(config)?.onMe], ['bag', false]);
    assert.deepEqual([...TRYON_WIDTH_MM.bag], [WIDTH_MM.bag.min, WIDTH_MM.bag.max]);
    for (const [caseMm, ok] of [[99, false], [100, true], [600, true], [601, false]] as const) {
      const c = { ...config, tryon: { ...config.tryon, caseMm } };
      assert.equal(!!parseConfig(c), ok, `widget ${caseMm}`);
      assert.equal(!!tryOnProductFrom(c), ok, `try-on page ${caseMm}`);
    }
  } finally { await harness.close(); }
});
