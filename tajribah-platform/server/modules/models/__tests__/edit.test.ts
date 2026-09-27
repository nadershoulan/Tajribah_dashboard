/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P3.8 — an edit is baked into a new version through the upload path: turned in 90° steps and/or
 * fitted to the product, stood on the floor, processed, never live until published, and a
 * generated model is reviewed again. Refusals say why.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { Document, WebIO } from '@gltf-transform/core';
import { models3d, modelVersions, products, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { confirmUpload, modelVersionsOf, startUpload } from '@/server/modules/models/service';
import { processVersion } from '@/server/modules/models/process';
import { editModel, modelFileFor } from '@/server/modules/models/edit';
import { listModels, publishVersion } from '@/server/modules/models/library';
import { turnedSize } from '@/lib/model-turn';

setLogLevel('error');

/** A 100 mm × 50 mm plate standing in the XY plane (a flat thing uploaded upright by mistake). */
async function plate(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const p = [0, 0, 0, 0.1, 0, 0, 0.1, 0.05, 0, 0, 0.05, 0];
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buffer));
  const scene = doc.createScene();
  scene.addChild(doc.createNode('plate').setMesh(doc.createMesh().addPrimitive(prim)));
  doc.getRoot().setDefaultScene(scene);
  return new WebIO().writeBinary(doc);
}

async function setup(harness: TestDb, dimensions: Record<string, number> | null = { widthMm: 200, heightMm: 20, depthMm: 100 }) {
  setStorage(new MemoryStorage());
  const store = await seedTenant(harness, 'alpha');
  const ctx = await buildTenantContext({ actor: { userId: store.userId, email: store.email, isStaff: false }, tenantId: store.tenantId, requestId: 'r' });
  const productId = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values({ id: productId, tenantId: store.tenantId, name: 'Tray', dimensions } as any));
  const bytes = await plate();
  const started = await startUpload(ctx, { filename: 'tray.glb', sizeBytes: bytes.byteLength, productId });
  await storage().put(started.uploadUrl.replace('memory://upload/', ''), bytes.slice().buffer as ArrayBuffer);
  await confirmUpload(ctx, started.versionId);
  assert.equal(await processVersion(store.tenantId, started.versionId, 'r'), 'ready');
  return { ...store, ctx, productId, modelId: started.modelId, v1: started.versionId };
}
const sizeOf = async (ctx: any, modelId: string, version: number) => (await modelVersionsOf(ctx, modelId)).find((v) => v.version === version)!;

test('turn a model that was uploaded standing up: a new version lies flat, on the floor; the old one stays live', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, modelId, v1 } = await setup(harness);
    await publishVersion(ctx, v1);
    assert.deepEqual((await sizeOf(ctx, modelId, 1)).sizeMm, [100, 50, 0]);

    const made = await editModel(ctx, modelId, { fromVersionId: v1, rotate: { x: 270 } });
    assert.equal(made.version, 2);
    assert.equal(await processVersion(tenantId, made.versionId, 'r'), 'ready');
    const v2 = await sizeOf(ctx, modelId, 2);
    assert.deepEqual(v2.sizeMm, [100, 0, 50], 'tipped back to lie flat: its height became its depth');
    const [row] = await harness.asAdmin(() => harness.db.select().from(modelVersions).where(eq(modelVersions.id, made.versionId)));
    assert.ok(Math.abs((row as any).boundingBox.min[1]) < 1e-6, 'on the floor, not through it');
    assert.equal((await sizeOf(ctx, modelId, 1)).isCurrent, true, 'the live version is untouched until the new one is published');

    // Upside down: turned about the front-to-back axis, it would hang below the floor unless re-stood.
    const flipped = await editModel(ctx, modelId, { fromVersionId: v1, rotate: { z: 180 } });
    await processVersion(tenantId, flipped.versionId, 'r');
    const [upside] = await harness.asAdmin(() => harness.db.select().from(modelVersions).where(eq(modelVersions.id, flipped.versionId)));
    // Within 0.1 mm: meshopt's position quantisation moves points by microns.
    assert.ok(Math.abs((upside as any).boundingBox.min[1]) < 1e-4, 'stood back on the floor after turning over');
    // Two turns, in order: tipped then spun — the file agrees with the editor's arithmetic.
    const both = await editModel(ctx, modelId, { fromVersionId: v1, rotate: { x: 90, y: 90 } });
    await processVersion(tenantId, both.versionId, 'r');
    const shown = turnedSize([100, 50, 0], { x: 90, y: 90, z: 0 });
    assert.deepEqual(shown, [50, 0, 100]);
    assert.deepEqual((await sizeOf(ctx, modelId, 4)).sizeMm, shown, 'what the editor showed is what the file became');

    const file = await modelFileFor(ctx, made.versionId);
    assert.equal(new TextDecoder().decode(new Uint8Array(await new Response(file.body).arrayBuffer()).subarray(0, 4)), 'glTF');
  } finally { await harness.close(); }
});

test('fit to the product: scaled evenly to the longest measurement; a generated model goes back to review', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, modelId, v1 } = await setup(harness);
    // An upload (processing never re-fits one), so the size can only come from the edit.
    const made = await editModel(ctx, modelId, { fromVersionId: v1, rotate: { x: 270 }, fit: true });
    await processVersion(tenantId, made.versionId, 'r');
    assert.deepEqual((await sizeOf(ctx, modelId, 2)).sizeMm, [200, 0, 100], 'lying flat and the tray’s 200 × 100 mm');

    await harness.asAdmin(() => harness.db.update(models3d).set({ source: 'ai_generated', qaStatus: 'approved' } as any).where(eq(models3d.id, modelId)));
    const turned = await editModel(ctx, modelId, { fromVersionId: made.versionId, rotate: { y: 90 } });
    await processVersion(tenantId, turned.versionId, 'r');
    assert.equal((await listModels(ctx))[0]!.qaStatus, 'pending', 'a generated model is reviewed again (T25)');
  } finally { await harness.close(); }
});

test('refusals: nothing to change, a turn that is not 90°, a version not ready, fitting with no measurements; roles and stores', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, modelId, v1 } = await setup(harness, null);
    await assert.rejects(() => editModel(ctx, modelId, { fromVersionId: v1 }), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => editModel(ctx, modelId, { fromVersionId: v1, rotate: { y: 45 as any } }), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => editModel(ctx, modelId, { fromVersionId: v1, fit: true }), (e: any) => e.code === 'conflict' && /no measurements/.test(e.message));
    const made = await editModel(ctx, modelId, { fromVersionId: v1, rotate: { z: 90 } });
    await assert.rejects(() => editModel(ctx, modelId, { fromVersionId: made.versionId, rotate: { z: 90 } }), (e: any) => e.code === 'conflict' && /processing/.test(e.message), 'only a ready version');
    await assert.rejects(() => editModel(ctx, modelId, { fromVersionId: uuidv7(), rotate: { z: 90 } }), (e: any) => e.code === 'not_found');

    const analystId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: analystId, email: 'an@example.test', passwordHash: 'x', fullName: 'A' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId: analystId, role: 'analyst', status: 'active' } as any);
    });
    const analyst = await buildTenantContext({ actor: { userId: analystId, email: 'an@example.test', isStaff: false }, tenantId, requestId: 'r' });
    await assert.rejects(() => editModel(analyst, modelId, { fromVersionId: v1, rotate: { z: 90 } }), (e: any) => e.code === 'forbidden');
    assert.ok((await modelFileFor(analyst, v1)).size > 0, 'an analyst can look');

    const other = await seedTenant(harness, 'bravo');
    const otherCtx = await buildTenantContext({ actor: { userId: other.userId, email: other.email, isStaff: false }, tenantId: other.tenantId, requestId: 'r' });
    await assert.rejects(() => editModel(otherCtx, modelId, { fromVersionId: v1, rotate: { z: 90 } }), (e: any) => e.code === 'not_found');
    await assert.rejects(() => modelFileFor(otherCtx, v1), (e: any) => e.code === 'not_found');
  } finally { await harness.close(); }
});
