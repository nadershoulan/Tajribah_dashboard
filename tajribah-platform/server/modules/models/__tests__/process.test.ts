/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { Document, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, KHRMaterialsClearcoat, KHRTextureBasisu } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { auditLogs, jobs, modelFiles, models3d, modelVersions, products, type Job } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { clearHandlers, registerHandler, tick } from '@/server/core/jobs/runner';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { confirmUpload, modelVersionsOf, startUpload } from '@/server/modules/models/service';
import { handleProcessJob, processVersion } from '@/server/modules/models/process';
import { NATIVE_EXTENSIONS, NATIVE_MAX_TEXTURE, optimizeGlb, statsOf, TARGET_BYTES } from '@/server/modules/models/optimize';
import { inspect } from '@/server/modules/models/inspect';

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

/** Noise, not a flat colour: `prune()` rightly turns a single-colour texture into a factor. */
const image = async (width: number, height: number, format: 'png' | 'webp' | 'jpeg') =>
  new Uint8Array(await sharp({ create: { width, height, channels: 3, background: '#000', noise: { type: 'gaussian', mean: 128, sigma: 40 } } })[format]().toBuffer());

/**
 * A textured quad with what Android's Scene Viewer cannot take: a 3000 px texture (its limit
 * is 2048), a WebP texture (PNG/JPEG only), and a second UV set, used by the occlusion map
 * (one UV set per mesh, a hard limit). `ktx2` swaps the base colour for a KTX2 image, which
 * nothing here can turn back into PNG.
 */
async function texturedGlb(options: { ktx2?: boolean; requireClearcoat?: boolean } = {}): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const base = doc.createTexture('base').setImage(await image(3000, 1500, 'png')).setMimeType('image/png');
  const glow = doc.createTexture('glow').setImage(await image(64, 64, 'webp')).setMimeType('image/webp');
  const ao = doc.createTexture('ao').setImage(await image(64, 64, 'jpeg')).setMimeType('image/jpeg');
  doc.createExtension(EXTTextureWebP).setRequired(true);
  if (options.ktx2) {
    base.setImage(new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])).setMimeType('image/ktx2');
    doc.createExtension(KHRTextureBasisu).setRequired(true);
  }
  if (options.requireClearcoat) doc.createExtension(KHRMaterialsClearcoat).setRequired(true);
  const material = doc.createMaterial('paint').setBaseColorTexture(base).setEmissiveTexture(glow).setEmissiveFactor([1, 1, 1]).setOcclusionTexture(ao);
  material.getOcclusionTextureInfo()!.setTexCoord(1);
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', accessor('VEC3', new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])))
    .setAttribute('TEXCOORD_0', accessor('VEC2', uv))
    .setAttribute('TEXCOORD_1', accessor('VEC2', uv.slice()))
    .setIndices(accessor('SCALAR', new Uint16Array([0, 1, 2, 0, 2, 3])))
    .setMaterial(material);
  const scene = doc.createScene();
  scene.addChild(doc.createNode('quad').setMesh(doc.createMesh().addPrimitive(primitive)));
  doc.getRoot().setDefaultScene(scene);
  return new WebIO().registerExtensions(ALL_EXTENSIONS).writeBinary(doc);
}

/** The JSON chunk of a GLB, as a viewer would see it before loading anything. */
const glbJson = (bytes: Uint8Array) =>
  JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true))));

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

test('the native GLB is one Android\'s Scene Viewer can read: no compression, PNG/JPEG ≤ 2048 px, one UV set', async () => {
  const result = await optimizeGlb(await texturedGlb());
  assert.ok(glbJson(result.bytes).extensionsUsed.includes('EXT_meshopt_compression'), 'the web file stays compressed');
  assert.ok('bytes' in result.native, `no native file: ${'skipped' in result.native ? result.native.skipped : ''}`);
  const native = result.native.bytes;

  const json = glbJson(native);
  const outside = (list: string[] = []) => list.filter((name) => !NATIVE_EXTENSIONS.includes(name));
  assert.deepEqual(outside(json.extensionsRequired), [], 'nothing required beyond what Scene Viewer documents');
  assert.deepEqual(outside(json.extensionsUsed), []);

  // Readable with no decoder registered at all — as a viewer without meshopt would read it.
  const doc = await new WebIO().readBinary(native);
  const sizes = await Promise.all(doc.getRoot().listTextures().map(async (t) => {
    const meta = await sharp(t.getImage()!).metadata();
    return [t.getName(), t.getMimeType(), meta.format, meta.width, meta.height];
  }));
  assert.deepEqual(sizes.sort(), [
    ['base', 'image/jpeg', 'jpeg', NATIVE_MAX_TEXTURE, NATIVE_MAX_TEXTURE / 2],
    ['glow', 'image/jpeg', 'jpeg', 64, 64],
  ], 'the big one scaled to fit 2048 keeping its shape, WebP turned into JPEG (opaque: P3.5), the occlusion map on UV 2 dropped');
  const [primitive] = doc.getRoot().listMeshes()[0].listPrimitives();
  assert.deepEqual(primitive.listSemantics().filter((s) => s.startsWith('TEXCOORD')), ['TEXCOORD_0']);
  assert.equal(primitive.getMaterial()!.getOcclusionTexture(), null);
  assert.equal(statsOf(doc).polyCount, 2);
});

test('no native GLB, with the reason, when a texture cannot become PNG or JPEG', async () => {
  const result = await optimizeGlb(await texturedGlb({ ktx2: true }));
  assert.ok('skipped' in result.native);
  assert.match(result.native.skipped, /image\/ktx2/);
  assert.ok(result.bytes.byteLength > 0, 'the web file is still made');

  const strict = await optimizeGlb(await texturedGlb({ requireClearcoat: true }));
  assert.ok('skipped' in strict.native, 'an extension the file requires and Scene Viewer lacks');
  assert.match(strict.native.skipped, /KHR_materials_clearcoat/);
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
    const optimized = files.find((f) => f.variant === 'optimized' && f.compression === 'meshopt');
    assert.equal(optimized.format, 'glb');
    assert.ok(optimized.storageKey.endsWith(`/v1/optimized.glb`));
    assert.equal((await storage().head(optimized.storageKey))?.size, optimized.fileSizeBytes);
    const native = files.find((f) => f.variant === 'optimized' && f.compression === 'none');
    assert.equal(native?.format, 'glb', 'a plain GLB for Scene Viewer, beside the web one');
    assert.ok(native.storageKey.endsWith(`/v1/native.glb`));
    assert.equal((await storage().head(native.storageKey))?.size, native.fileSizeBytes);
    const iphone = files.find((f) => f.variant === 'optimized' && f.format === 'usdz');
    assert.ok(iphone?.storageKey.endsWith('/v1/model.usdz'), 'P1.13b: and a USDZ for iPhone Quick Look, made from the plain one');
    assert.equal(iphone.compression, 'none');
    const stored = await storage().get(iphone.storageKey);
    const head = new Uint8Array(await new Response(stored!.body).arrayBuffer());
    assert.equal(head.byteLength, iphone.fileSizeBytes);
    assert.equal(inspect('usdz', head, head.byteLength), null, 'a USDZ our own upload check accepts');

    const [version] = await modelVersionsOf(ctx, started.modelId);
    assert.deepEqual([version.status, version.isCurrent, version.polyCount, version.originalBytes, version.withinTarget],
      ['ready', false, 1600, bytes.byteLength, true]);
    assert.ok(version.optimizedBytes! < version.originalBytes!);
    assert.equal(version.optimizedBytes, optimized.fileSizeBytes, 'the size report is the web file, not the native one');
    const model = (await admin(harness, () => harness.db.select().from(models3d).where(eq(models3d.id, started.modelId))))[0] as any;
    assert.deepEqual([model.status, model.currentVersionId], ['ready', null]);
    const trail = await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceId, started.versionId))) as any[];
    const done = trail.find((r) => r.changes?.after?.status === 'ready');
    assert.deepEqual([done.actorType, done.changes.after.withinTarget], ['system', true]);
    assert.equal(done.changes.after.nativeBytes, native.fileSizeBytes);
    assert.equal(done.changes.after.quickLookBytes, iphone.fileSizeBytes);
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
    assert.equal((await admin(harness, () => harness.db.select().from(modelFiles).where(eq(modelFiles.variant, 'optimized')))).length, 3, 'web, native and iPhone, each written once');

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

test('P3.5: a generated model is fitted to its product and noted for QA when its shape disagrees; an upload is not', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    // The grid is 3 × 1 units, starting at the origin: no real size of its own.
    const cases: [string, Record<string, number> | null, 'uploaded' | 'ai_generated'][] = [
      ['fits', { widthMm: 300, heightMm: 100 }, 'ai_generated'],
      ['disagrees', { widthMm: 300, heightMm: 250 }, 'ai_generated'],
      ['unmeasured', null, 'ai_generated'],
      ['own file', { widthMm: 300, heightMm: 100 }, 'uploaded'],
    ];
    const made: Record<string, { versionId: string; modelId: string }> = {};
    for (const [name, dimensions, source] of cases) {
      const productId = uuidv7();
      await admin(harness, () => harness.db.insert(products).values({ id: productId, tenantId, name, dimensions } as any));
      const bytes = await wastefulGlb();
      const run = await startUpload(ctx, { filename: 'grid.glb', sizeBytes: bytes.byteLength, productId });
      await storage().put(run.uploadUrl.replace('memory://upload/', ''), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      if (source === 'ai_generated') await admin(harness, () => harness.db.update(models3d).set({ source } as any).where(eq(models3d.id, run.modelId)));
      await confirmUpload(ctx, run.versionId);
      made[name] = { versionId: run.versionId, modelId: run.modelId };
    }
    await drain();

    const version = async (name: string) => (await admin(harness, () => harness.db.select().from(modelVersions).where(eq(modelVersions.id, made[name]!.versionId))))[0] as any;
    const model = async (name: string) => (await admin(harness, () => harness.db.select().from(models3d).where(eq(models3d.id, made[name]!.modelId))))[0] as any;
    const mm = (box: any) => [...box.min, ...box.max].map((v: number) => Math.round(v * 1000));

    const fits = await version('fits');
    assert.equal(fits.status, 'ready');
    assert.deepEqual(mm(fits.boundingBox), [-150, 0, 0, 150, 100, 0], '300 × 100 mm, on the floor, centred');
    assert.equal((await model('fits')).qaNotes, null);

    assert.deepEqual(mm((await version('disagrees')).boundingBox), [-150, 0, 0, 150, 100, 0], 'sized by its longest side, never stretched');
    assert.match((await model('disagrees')).qaNotes, /check the shape: sized to 300 × 100 × 0 mm/);
    assert.equal((await model('disagrees')).qaStatus, 'pending');

    assert.match((await model('unmeasured')).qaNotes, /not sized: the product has no measurements/);
    assert.deepEqual(mm((await version('own file')).boundingBox), [0, 0, 0, 3000, 1000, 0], 'an upload keeps its own size');
    assert.equal((await model('own file')).qaNotes, null);
  } finally { await harness.close(); }
});
