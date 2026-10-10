/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T134.6 — the store sets where its product sits on the model photos: saved with the try-on settings, checked in full,
 * reloaded as saved, shown in the dashboard's preview, published to the shop (the website's studio reads it), and given
 * back to the built-in place on request.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { arConfigs, subscriptions } from '@/db/schema';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { publishTryOn } from '@/server/modules/tryon/publish';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, forTenant, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import { confirmCutout, startCutoutUpload, tryOnOne, updateTryOn } from '@/server/modules/tryon/service';
import { tryOnPreview } from '@/server/modules/tryon/preview';
import { tryOnProductFrom } from '@site/lib/tryon-config';
import { products } from '@/db/schema';

setLogLevel('error');
const FRAME = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'assets', 'glasses-front.png')));
class CdnStorage extends MemoryStorage { publicUrl(k: string) { return `https://cdn.example.test/${k}`; } }

async function glassesStore(harness: TestDb, name: string) {
  setStorage(new CdnStorage());
  const seeded = await seedTenant(harness, name);
  const planId = await seededPlanId(harness, 'pro');
  const now = new Date();
  await harness.asAdmin(() => harness.db.insert(subscriptions).values({ id: uuidv7(), tenantId: seeded.tenantId, planId, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) } as any));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const id = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values({ id, tenantId: seeded.tenantId, externalId: id, name: 'Round frame', productType: 'eyewear' } as any));
  await harness.asAdmin(() => harness.db.insert(arConfigs).values({ id: uuidv7(), tenantId: seeded.tenantId, productId: id, placement: 'face' } as any));
  const started = await startCutoutUpload(ctx, id, { slot: 'worn', filename: 'frame.png', contentType: 'image/png', sizeBytes: FRAME.length });
  await forTenant(ctx.tenantId).put(started.key, FRAME.slice().buffer as ArrayBuffer);
  await confirmCutout(ctx, id, { slot: 'worn', key: started.key });
  await updateTryOn(ctx, id, { caseMm: 132 });
  return { ctx, id };
}

const FACE = { zone: { x: 540, y: 480, w: 120, h: 90 }, pose: { x: 600, y: 520, angle: -3, scale: 1.1 } };

test('saved, reloaded as saved, in the preview the dashboard shows, and published to the shop', async () => {
  const harness = await createTestDb();
  try {
    const kv = new MemoryConfigStore();
    setConfigStore(kv);
    const { ctx, id } = await glassesStore(harness, 'placed');
    assert.equal((await tryOnOne(ctx, id)).watches[0]!.placement, null, 'nothing set: the built-in place');

    const saved = await updateTryOn(ctx, id, { placement: { face: FACE } });
    assert.deepEqual(saved.placement, { face: FACE });
    assert.deepEqual((await tryOnOne(ctx, id)).watches[0]!.placement, { face: FACE }, 'it reloads as saved');

    const preview = await tryOnPreview(ctx, id, null);
    assert.deepEqual(tryOnProductFrom(preview.config)?.placement, { face: FACE }, 'the dashboard’s preview shows it before publishing');
    assert.equal(tryOnProductFrom((await tryOnPreview(ctx, id, 'bag')).config)?.placement, undefined, 'tried as another kind: not its place');

    await publishTryOn(ctx, id);
    const config = JSON.parse([...kv.entries.values()][0]!.body);
    assert.deepEqual(config.tryon.placement, { face: FACE }, 'published with the try-on');
    assert.deepEqual(tryOnProductFrom(config)?.placement, { face: FACE }, 'and the shop’s studio reads it');

    await updateTryOn(ctx, id, { placement: null });
    assert.equal((await tryOnOne(ctx, id)).watches[0]!.placement, null, 'back to the built-in place');
    const after = JSON.parse([...kv.entries.values()][0]!.body);
    assert.equal(after.tryon.placement, undefined, 'and the shop is updated');
  } finally {
    await harness.close();
  }
});

test('checked in full: a photo this kind is not shown on, a zone off the photo, the product outside its zone — nothing saved', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, id } = await glassesStore(harness, 'checked');
    const refused = async (placement: unknown, field: string) => {
      await assert.rejects(() => updateTryOn(ctx, id, { placement }), (e: any) => e.status === 422 && field in (e.errors ?? {}), field);
    };
    await refused({ wrist: FACE }, 'placement.wrist');
    await refused({ face: { ...FACE, zone: { x: 1150, y: 480, w: 120, h: 90 } } }, 'placement.face');
    await refused({ face: { ...FACE, pose: { ...FACE.pose, x: 200 } } }, 'placement.face');
    await refused({ face: { ...FACE, pose: { ...FACE.pose, scale: 3 } } }, 'placement.face');
    assert.equal((await tryOnOne(ctx, id)).watches[0]!.placement, null, 'nothing saved');
  } finally {
    await harness.close();
  }
});
