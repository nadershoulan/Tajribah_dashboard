/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { Document, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { auditLogs, jobs, modelFiles, models3d, modelVersions, type Job } from '@/db/schema';
import { clearHandlers, registerHandler, tick } from '@/server/core/jobs/runner';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { confirmUpload, modelVersionsOf, startUpload } from '@/server/modules/models/service';
import { handleProcessJob, processVersion } from '@/server/modules/models/process';
import { optimizeGlb, statsOf, TARGET_BYTES } from '@/server/modules/models/optimize';

setLogLevel('error');
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);

/**
 * A GLB with waste an optimiser should find: an unindexed 20×20 grid (every shared corner
 * stored again per triangle), the same mesh twice, and a material nothing uses.
 */
async function wastefulGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const n = 20;
  const positions: number[] = [];
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
    const quad = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y], [x + 1, y + 1], [x, y + 1]];
    for (const [a, b] of quad) positions.push(a / n, b / n, 0);
  }
  const makeMesh = () => {
    const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer);
    return doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position));
  };
  doc.createMaterial('unused');
  const scene = doc.createScene();
  scene.addChild(doc.createNode('a').setMesh(makeMesh()));
  scene.addChild(doc.createNode('b').setMesh(makeMesh()).setTranslation([2, 0, 0]));
  doc.getRoot().setDefaultScene(scene);
  return new WebIO().writeBinary(doc);
}

async function merchant(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

async function upload(ctx: any, bytes: Uint8Array, filename = 'grid.glb') {
  const started = await startUpload(ctx, { filename, sizeBytes: bytes.byteLength });
  const key = started.uploadUrl.replace('memory://upload/', '');
  await storage().put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { contentType: started.contentType });
  return { started, key, confirmed: await confirmUpload(ctx, started.versionId) };
}

async function drain() {
  clearHandlers();
  registerHandler('ai.postprocess', (job: Job) => handleProcessJob(job));
  while ((await tick('test-worker', 10)).claimed > 0) { /* until empty */ }
}

test('optimizeGlb: smaller, same triangles, readable again with the meshopt decoder', async () => {
  const original = await wastefulGlb();
  const { bytes, stats } = await optimizeGlb(original);
  assert.ok(bytes.byteLength < original.byteLength / 2, `${original.byteLength} → ${bytes.byteLength}`);
  assert.deepEqual([stats.polyCount, stats.materialCount, stats.textureCount], [1600, 0, 0], 'one mesh after dedup, drawn by 2 nodes × 800 triangles; the unused material pruned');
  assert.deepEqual(stats.boundingBox, { min: [0, 0, 0], max: [3, 1, 0] });

  await MeshoptDecoder.ready;
  const again = await new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(bytes);
  assert.equal(statsOf(again).polyCount, 1600);
  // weld + dedup: the GPU draws one shared mesh of 21×21 vertices, not 2 × 2,400 copies.
  assert.equal(again.getRoot().listMeshes().length, 1);
  assert.equal(again.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION')!.getCount(), 441);
  assert.ok(again.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression'));
});

test('confirm queues processing; the worker makes an optimised file and a ready version, never a live one', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx } = await merchant(harness, 'alpha');
    const bytes = await wastefulGlb();
    const { started } = await upload(ctx, bytes);
    assert.equal((await admin(harness, () => harness.db.select().from(jobs))).length, 1, 'one job, enqueued after the confirm committed');

    await drain();
    const files = await admin(harness, () => harness.db.select().from(modelFiles).where(eq(modelFiles.modelVersionId, started.versionId))) as any[];
    const optimized = files.find((f) => f.variant === 'optimized');
    assert.deepEqual([optimized.format, optimized.compression], ['glb', 'meshopt']);
    assert.ok(optimized.storageKey.endsWith(`/v1/optimized.glb`));
    assert.equal((await storage().head(optimized.storageKey))?.size, optimized.fileSizeBytes);

    const [version] = await modelVersionsOf(ctx, started.modelId);
    assert.deepEqual([version.status, version.isCurrent, version.polyCount, version.originalBytes, version.withinTarget],
      ['ready', false, 1600, bytes.byteLength, true]);
    assert.ok(version.optimizedBytes! < version.originalBytes!);
    const model = (await admin(harness, () => harness.db.select().from(models3d).where(eq(models3d.id, started.modelId))))[0] as any;
    assert.deepEqual([model.status, model.currentVersionId], ['ready', null]);
    const trail = await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceId, started.versionId))) as any[];
    const done = trail.find((r) => r.changes?.after?.status === 'ready');
    assert.deepEqual([done.actorType, done.changes.after.withinTarget], ['system', true]);
  } finally { await harness.close(); }
});

test('processing twice changes nothing; a file that passed the header check but cannot be read fails for good', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    const { started } = await upload(ctx, await wastefulGlb());
    assert.equal(await processVersion(tenantId, started.versionId, 'r1'), 'ready');
    assert.equal(await processVersion(tenantId, started.versionId, 'r2'), 'skipped');
    assert.equal((await admin(harness, () => harness.db.select().from(modelFiles).where(eq(modelFiles.variant, 'optimized')))).length, 1);

    // A valid GLB header around JSON that is not glTF.
    const json = new TextEncoder().encode('{"not":"gltf"}  ');
    const broken = new Uint8Array(20 + json.byteLength);
    const view = new DataView(broken.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, broken.byteLength, true);
    view.setUint32(12, json.byteLength, true); view.setUint32(16, 0x4e4f534a, true); broken.set(json, 20);
    const bad = await upload(ctx, broken, 'broken.glb');
    assert.equal(bad.confirmed.status, 'processing', 'the header is fine');
    assert.equal(await processVersion(tenantId, bad.started.versionId, 'r3'), 'failed');
    const [row] = await admin(harness, () => harness.db.select().from(modelVersions).where(eq(modelVersions.id, bad.started.versionId))) as any[];
    assert.equal(row.status, 'failed');
    assert.ok(row.error, 'why it failed is kept on the version');
  } finally { await harness.close(); }
});

test('a storage failure is thrown for the queue to retry, and the version stays processing', async () => {
  const harness = await createTestDb();
  const memory = new MemoryStorage();
  setStorage(memory);
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    const { started } = await upload(ctx, await wastefulGlb());
    const realGet = memory.get.bind(memory);
    memory.get = async () => { throw new Error('storage unavailable'); };
    await assert.rejects(() => processVersion(tenantId, started.versionId, 'r1'), /storage unavailable/);
    memory.get = realGet;
    const [row] = await admin(harness, () => harness.db.select().from(modelVersions).where(eq(modelVersions.id, started.versionId))) as any[];
    assert.equal(row.status, 'processing');
    assert.equal(await processVersion(tenantId, started.versionId, 'r2'), 'ready');
  } finally { await harness.close(); }
});

test('a USDZ is marked ready as uploaded; the size report stays empty until there is something to measure', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    const name = new TextEncoder().encode('model.usdc');
    const usdz = new Uint8Array(30 + name.byteLength + 16);
    new DataView(usdz.buffer).setUint32(0, 0x04034b50, true);
    new DataView(usdz.buffer).setUint16(26, name.byteLength, true);
    usdz.set(name, 30);
    const { started } = await upload(ctx, usdz, 'watch.usdz');
    assert.equal(await processVersion(tenantId, started.versionId, 'r1'), 'ready');
    const [version] = await modelVersionsOf(ctx, started.modelId);
    assert.deepEqual([version.optimizedBytes, version.withinTarget], [null, null]);
    assert.ok(TARGET_BYTES === 2 * 1024 * 1024);
  } finally { await harness.close(); }
});
