/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, modelFiles, models3d, modelVersions, products, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { inspect, MAX_MODEL_BYTES } from '@/server/modules/models/inspect';
import { confirmUpload, modelVersionsOf, startUpload } from '@/server/modules/models/service';

setLogLevel('error');
const code = (e: any) => e.code;
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);

/** A minimal, valid glTF 2.0 binary: 12-byte header, then the JSON chunk. */
function glb(json = '{"asset":{"version":"2.0"}}'): Uint8Array {
  const text = new TextEncoder().encode(json);
  const padded = Math.ceil(text.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + padded).fill(0x20, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(text, 20);
  return bytes;
}

/** A zip local file header for `name`, stored (method 0) as USDZ requires. */
function usdz(name = 'model.usdc', method = 0): Uint8Array {
  const n = new TextEncoder().encode(name);
  const bytes = new Uint8Array(30 + n.byteLength + 16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(8, method, true);
  view.setUint16(26, n.byteLength, true);
  bytes.set(n, 30);
  return bytes;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(40).fill(0)]);

async function merchant(harness: TestDb, name: string, role: 'owner' | 'viewer' = 'owner') {
  const seeded = await seedTenant(harness, name);
  let userId = seeded.userId;
  if (role !== 'owner') {
    userId = uuidv7();
    await admin(harness, async () => {
      await harness.db.insert(users).values({ id: userId, email: `${role}-${name}@example.test`, passwordHash: 'x', fullName: role } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: seeded.tenantId, userId, role, status: 'active' } as any);
    });
  }
  const ctx = await buildTenantContext({ actor: { userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

/** What the browser does with the presigned URL. */
async function putBytes(uploadUrl: string, bytes: Uint8Array, contentType: string) {
  const key = uploadUrl.replace('memory://upload/', '');
  await storage().put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { contentType });
  return key;
}

test('inspect: GLB and USDZ by their bytes, not their names', () => {
  const good = glb();
  assert.equal(inspect('glb', good, good.byteLength), null);
  assert.match(inspect('glb', PNG, PNG.byteLength)!, /not a GLB/);
  const v1 = glb(); new DataView(v1.buffer).setUint32(4, 1, true);
  assert.match(inspect('glb', v1, v1.byteLength)!, /version 1/);
  assert.match(inspect('glb', good, good.byteLength + 100)!, /cut off/, 'declared length ≠ stored size');
  const noJson = glb(); new DataView(noJson.buffer).setUint32(16, 0x004e4942, true);
  assert.match(inspect('glb', noJson, noJson.byteLength)!, /JSON chunk/);
  assert.match(inspect('glb', good.subarray(0, 10), 10)!, /too short/);

  const u = usdz();
  assert.equal(inspect('usdz', u, u.byteLength), null);
  assert.match(inspect('usdz', usdz('model.usdc', 8), 100)!, /uncompressed/);
  assert.match(inspect('usdz', usdz('texture.png'), 100)!, /USD scene/);
  assert.match(inspect('usdz', PNG, PNG.byteLength)!, /not a zip/);
});

test('upload a GLB for a product: presigned URL in the tenant\'s space, confirm, version 1 processing', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    const [product] = await admin(harness, () => harness.db.insert(products).values({ tenantId, name: 'Oyster 41' } as any).returning()) as any[];
    const bytes = glb();
    const started = await startUpload(ctx, { filename: 'oyster 41.glb', sizeBytes: bytes.byteLength, productId: product.id });
    assert.equal(started.version, 1);
    assert.equal(started.contentType, 'model/gltf-binary');
    const key = await putBytes(started.uploadUrl, bytes, started.contentType);
    assert.ok(key.startsWith(`t/${tenantId}/model/${started.modelId}/v1/`), key);

    const confirmed = await confirmUpload(ctx, started.versionId);
    assert.deepEqual(confirmed, { versionId: started.versionId, status: 'processing', error: null });
    const model = (await admin(harness, () => harness.db.select().from(models3d).where(eq(models3d.id, started.modelId))))[0] as any;
    assert.deepEqual([model.productId, model.name, model.status, model.currentVersionId], [product.id, 'Oyster 41', 'processing', null], 'an upload never makes itself live');
    const [file] = await admin(harness, () => harness.db.select().from(modelFiles)) as any[];
    assert.deepEqual([file.format, file.variant, file.fileSizeBytes, file.originalFilename], ['glb', 'original', bytes.byteLength, 'oyster 41.glb']);

    const trailBefore = (await admin(harness, () => harness.db.select().from(auditLogs))).length;
    assert.equal((await confirmUpload(ctx, started.versionId)).status, 'processing', 'confirming twice is harmless');
    assert.equal((await admin(harness, () => harness.db.select().from(auditLogs))).length, trailBefore, '…and records nothing new');
  } finally { await harness.close(); }
});

test('a file that is not what it claims is refused, deleted, and its version marked failed', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx } = await merchant(harness, 'alpha');
    const png = await startUpload(ctx, { filename: 'watch.glb', sizeBytes: PNG.byteLength });
    const key = await putBytes(png.uploadUrl, PNG, png.contentType);
    const refused = await confirmUpload(ctx, png.versionId);
    assert.equal(refused.status, 'failed');
    assert.match(refused.error!, /not a GLB/);
    assert.equal(await storage().head(key), null, 'refused bytes are not kept');
    assert.equal((await confirmUpload(ctx, png.versionId)).status, 'failed', 'asking again still says failed, not "not arrived yet"');

    const whole = glb('{"asset":{"version":"2.0"},"padding":"' + 'x'.repeat(200) + '"}');
    const cut = await startUpload(ctx, { filename: 'watch.glb', sizeBytes: whole.byteLength, modelId: png.modelId });
    await putBytes(cut.uploadUrl, whole.subarray(0, whole.byteLength - 64), cut.contentType);
    assert.match((await confirmUpload(ctx, cut.versionId)).error!, /cut off/);

    const statuses = (await modelVersionsOf(ctx, png.modelId)).map((v) => [v.version, v.status]);
    assert.deepEqual(statuses, [[2, 'failed'], [1, 'failed']]);
  } finally { await harness.close(); }
});

test('confirm before the bytes arrive is a conflict; nothing changes', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx } = await merchant(harness, 'alpha');
    const started = await startUpload(ctx, { filename: 'a.usdz', sizeBytes: 100 });
    await assert.rejects(() => confirmUpload(ctx, started.versionId), (e: any) => code(e) === 'conflict');
    const [version] = await admin(harness, () => harness.db.select().from(modelVersions)) as any[];
    assert.equal(version.status, 'draft');
    const bytes = usdz();
    await putBytes(started.uploadUrl, bytes, started.contentType);
    assert.equal((await confirmUpload(ctx, started.versionId)).status, 'processing');
  } finally { await harness.close(); }
});

test('versions count up per model, also when two uploads start at once', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    const [product] = await admin(harness, () => harness.db.insert(products).values({ tenantId, name: 'Bag' } as any).returning()) as any[];
    const first = await startUpload(ctx, { filename: 'bag.glb', sizeBytes: 100, productId: product.id });
    const [a, b] = await Promise.all([
      startUpload(ctx, { filename: 'bag.glb', sizeBytes: 100, productId: product.id }),
      startUpload(ctx, { filename: 'bag.usdz', sizeBytes: 100, productId: product.id }),
    ]);
    assert.deepEqual(new Set([first.modelId, a.modelId, b.modelId]).size, 1, 'one model per product');
    assert.deepEqual([first.version, ...[a.version, b.version].sort()], [1, 2, 3]);
    assert.ok((await modelVersionsOf(ctx, first.modelId)).every((v) => v.isCurrent === false));
  } finally { await harness.close(); }
});

test('refused before any URL: wrong type, empty, too big, a viewer, another store\'s product or version', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx } = await merchant(harness, 'alpha');
    const bad = (input: any, field: string) => assert.rejects(() => startUpload(ctx, input), (e: any) => code(e) === 'validation_failed' && field in e.errors);
    await bad({ filename: 'model.obj', sizeBytes: 10 }, 'filename');
    await bad({ filename: 'model.glb', sizeBytes: 0 }, 'sizeBytes');
    await bad({ filename: 'model.glb', sizeBytes: MAX_MODEL_BYTES + 1 }, 'sizeBytes');

    const viewer = await merchant(harness, 'gamma', 'viewer');
    await assert.rejects(() => startUpload(viewer.ctx, { filename: 'm.glb', sizeBytes: 10 }), (e: any) => code(e) === 'forbidden');

    const other = await merchant(harness, 'beta');
    const [theirs] = await admin(harness, () => harness.db.insert(products).values({ tenantId: other.tenantId, name: 'Theirs' } as any).returning()) as any[];
    await assert.rejects(() => startUpload(ctx, { filename: 'm.glb', sizeBytes: 10, productId: theirs.id }), (e: any) => code(e) === 'not_found');
    const mine = await startUpload(ctx, { filename: 'm.glb', sizeBytes: 10 });
    await assert.rejects(() => confirmUpload(other.ctx, mine.versionId), (e: any) => code(e) === 'not_found');
    await assert.rejects(() => startUpload(other.ctx, { filename: 'm.glb', sizeBytes: 10, modelId: mine.modelId }), (e: any) => code(e) === 'not_found');
  } finally { await harness.close(); }
});
