/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P3.8 — a 3D model's picture (the view chosen in the 3D editor): uploaded straight to storage,
 * checked from its own bytes, counted in storage, shown in the list, named by the live config (the
 * product page's link preview), replaced and deleted without leaving a file a shopper may still need.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { auditLogs, jobs, modelFiles, models3d, modelVersions, products, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { storageBytesHeld } from '@/server/core/billing/entitlements';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { deleteModel, listModels } from '@/server/modules/models/library';
import { confirmPicture, pictureFile, pictureProblem, startPictureUpload } from '@/server/modules/models/picture';
import { publishProduct } from '@/server/modules/edge/publish';
import { handleDeleteLater } from '@/server/modules/tryon/retire';
import { hostedProductFrom } from '@site/lib/hosted-page';

setLogLevel('error');

class CdnStorage extends MemoryStorage {
  publicUrl(k: string) { return `https://cdn.example.test/${k}`; }
}

const shot = async (w: number, h: number, format: 'webp' | 'png' | 'jpeg' = 'webp') =>
  new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#2a6f8f' } })[format]().toBuffer());

async function store(harness: TestDb, name: string) {
  const s = new CdnStorage();
  setStorage(s);
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  const seeded = await seedTenant(harness, name, { plan: 'pro' });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx, kv };
}

/** A lamp whose model's version 1 is live, so a published config names its files (and its picture). */
async function liveLamp(harness: TestDb, tenantId: string) {
  const [product] = (await harness.asAdmin(() => harness.db.insert(products).values({
    tenantId, name: 'Arc lamp', nameAr: 'مصباح', productType: 'other', externalId: 'sa-77', arEnabled: true,
  } as any).returning())) as any[];
  const modelId = uuidv7();
  const versionId = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(models3d).values({ id: modelId, tenantId, productId: product.id, name: 'Arc', source: 'uploaded', status: 'ready', currentVersionId: versionId } as any);
    await harness.db.insert(modelVersions).values({ id: versionId, tenantId, modelId, version: 1, status: 'ready' } as any);
    await harness.db.insert(modelFiles).values({ id: uuidv7(), tenantId, modelVersionId: versionId, format: 'glb', variant: 'optimized', compression: 'meshopt', storageKey: `t/${tenantId}/model/${modelId}/v1/optimized.glb`, fileSizeBytes: 1000 } as any);
  });
  return { product, modelId };
}

async function setPicture(ctx: any, modelId: string, bytes: Uint8Array, contentType = 'image/webp') {
  const started = await startPictureUpload(ctx, modelId, { contentType, sizeBytes: bytes.byteLength });
  const key = started.uploadUrl.replace('memory://upload/', '');
  assert.equal(key, started.key);
  await storage().put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { contentType });
  return { key, result: await confirmPicture(ctx, modelId, { key }) };
}

test('a picture of the right kind and size becomes the model’s: listed, counted, served, audited', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'oud');
    const { modelId } = await liveLamp(harness, tenantId);
    const before = await storageBytesHeld(ctx);
    const bytes = await shot(800, 600);
    const { key, result } = await setPicture(ctx, modelId, bytes);
    assert.match(key, new RegExp(`^t/${tenantId}/model/${modelId}/picture-[0-9a-f-]{36}\\.webp$`));
    assert.equal(result.pictureBytes, bytes.byteLength);
    assert.equal(await storageBytesHeld(ctx), before + bytes.byteLength, 'it counts against the plan’s storage');
    const [row] = await listModels(ctx);
    assert.equal(row!.thumbnailUrl, `https://cdn.example.test/${key}`, 'the list (and the public API) name it');
    const file = await pictureFile(ctx, modelId);
    assert.equal(file.contentType, 'image/webp');
    assert.deepEqual(new Uint8Array(await new Response(file.body).arrayBuffer()), bytes, 'the dashboard reads it back');
    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceId, modelId))) as any[];
    assert.ok(trail.some((r) => r.changes?.after?.pictureKey === key), 'audited');
  } finally { await harness.close(); }
});

test('only a real picture, of a sensible size, under this model’s key, from someone who may edit models', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'oud2');
    const { modelId } = await liveLamp(harness, tenantId);
    await assert.rejects(() => startPictureUpload(ctx, modelId, { contentType: 'image/gif', sizeBytes: 100 }), (e: any) => !!e.errors?.contentType);
    await assert.rejects(() => startPictureUpload(ctx, modelId, { contentType: 'image/webp', sizeBytes: 3 * 1024 * 1024 }), (e: any) => !!e.errors?.sizeBytes);
    await assert.rejects(() => startPictureUpload(ctx, uuidv7(), { contentType: 'image/webp', sizeBytes: 100 }), (e: any) => e.code === 'not_found');

    for (const [bytes, type, why] of [
      [new TextEncoder().encode('<svg onload=alert(1)>'), 'image/webp', /not a WebP, PNG or JPEG/],
      [await shot(120, 120), 'image/webp', /too small/],
      [await shot(1200, 400), 'image/webp', /long and thin/],
      [await shot(400, 400, 'png'), 'image/webp', /not the kind it was uploaded as/],
    ] as const) {
      const started = await startPictureUpload(ctx, modelId, { contentType: type, sizeBytes: bytes.byteLength });
      await storage().put(started.key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {});
      await assert.rejects(() => confirmPicture(ctx, modelId, { key: started.key }), (e: any) => e.code === 'validation_failed' && why.test(e.errors.picture[0]), String(why));
      assert.equal(await storage().head(started.key), null, 'refused bytes are deleted at once');
    }
    assert.equal(pictureProblem(await shot(2100, 1500), 'x.webp'), 'too large — at most 2048 pixels a side');
    assert.equal(pictureProblem(await shot(500, 500, 'jpeg'), 'x.jpg'), null, 'a JPEG is fine');

    await assert.rejects(() => confirmPicture(ctx, modelId, { key: `t/${tenantId}/model/${modelId}/v1/optimized.glb` }), (e: any) => e.code === 'not_found', 'nothing else of the store can be attached');
    const texture = `t/${tenantId}/model/${modelId}/v1/texture.png`; // a real picture, but not an upload of this model's picture
    const png = await shot(400, 400, 'png');
    await storage().put(texture, png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, {});
    await assert.rejects(() => confirmPicture(ctx, modelId, { key: texture }), (e: any) => e.code === 'not_found', 'not even a picture of the model’s own');
    await assert.rejects(() => confirmPicture(ctx, modelId, { key: `t/${tenantId}/model/${modelId}/picture-${uuidv7()}.webp` }), (e: any) => e.code === 'conflict', 'not uploaded yet');
    assert.equal((await listModels(ctx))[0]!.thumbnailUrl, null, 'nothing refused became the picture');

    const viewerId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: viewerId, email: 'v@oud.sa', passwordHash: 'x', fullName: 'V' } as any);
      await harness.db.insert(tenantMemberships).values({ tenantId, userId: viewerId, role: 'viewer' } as any);
    });
    const viewer = await buildTenantContext({ actor: { userId: viewerId, email: 'v@oud.sa', isStaff: false }, tenantId, requestId: 'r' });
    await assert.rejects(() => startPictureUpload(viewer, modelId, { contentType: 'image/webp', sizeBytes: 100 }), (e: any) => e.code === 'forbidden');
    const other = await store(harness, 'other');
    await assert.rejects(() => startPictureUpload(other.ctx, modelId, { contentType: 'image/webp', sizeBytes: 100 }), (e: any) => e.code === 'not_found', 'another store’s model does not exist');
  } finally { await harness.close(); }
});

test('published, the config names the picture — the product page’s link preview; a replaced one goes only when no shopper needs it', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'oud3');
    const { product, modelId } = await liveLamp(harness, tenantId);
    await publishProduct(ctx, product.id);
    assert.equal(JSON.parse(kv.entries.get('oud3/sa-77.json')!.body).picture, null, 'no picture yet');

    const first = await setPicture(ctx, modelId, await shot(800, 800));
    const config = JSON.parse(kv.entries.get('oud3/sa-77.json')!.body);
    assert.equal(config.picture, `https://cdn.example.test/${first.key}`, 'the live config follows at once');
    const page = hostedProductFrom(config)!;
    assert.equal(page.image, config.picture, 'the product page’s link preview');
    assert.equal(page.picture, config.picture, 'and its viewer’s loading picture');

    const second = await setPicture(ctx, modelId, await shot(900, 700));
    assert.equal(JSON.parse(kv.entries.get('oud3/sa-77.json')!.body).picture, `https://cdn.example.test/${second.key}`);
    assert.ok(await storage().head(first.key), 'the old picture stays a while: shoppers may hold the older config');
    const [later] = (await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.queue, 'storage.delete-later')))) as any[];
    assert.equal(later.payload.key, first.key);
    await handleDeleteLater(later);
    assert.equal(await storage().head(first.key), null, 'then it goes');
    await handleDeleteLater({ ...later, payload: { productId: product.id, key: second.key } } as any);
    assert.ok(await storage().head(second.key), 'the current picture is never deleted by a late job');

    await deleteModel(ctx, modelId);
    const gone = (await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.queue, 'storage.delete-later')))) as any[];
    const job = gone.find((j) => j.payload.key === second.key);
    assert.ok(job, 'deleting the model schedules its picture to go (shoppers may still hold the config)');
    await handleDeleteLater(job);
    assert.equal(await storage().head(second.key), null, 'and it goes');
    const model = (await harness.asAdmin(() => harness.db.select().from(models3d).where(eq(models3d.id, modelId))))[0] as any;
    assert.equal(model.pictureKey, null, 'deleting the model takes its picture');
    assert.equal(await storageBytesHeld(ctx), 0, 'and nothing is counted any more');
  } finally { await harness.close(); }
});
