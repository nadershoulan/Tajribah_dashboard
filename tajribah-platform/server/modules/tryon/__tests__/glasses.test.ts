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
import { tryOnProductFrom } from '../../../../../tajribah-try-on/lib/tryon-config';

setLogLevel('error');
const FRAME = new Uint8Array(readFileSync(join(process.cwd(), '..', 'tajribah-try-on', 'public', 'assets', 'glasses-front.png')));
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
    assert.equal(studio?.onMe, false, 'no face finding in the shopper’s photo yet');
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
