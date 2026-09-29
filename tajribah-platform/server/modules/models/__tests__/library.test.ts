/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { Document, WebIO } from '@gltf-transform/core';
import { auditLogs, jobs, modelFiles, models3d, products, tenantMemberships, users } from '@/db/schema';
import { storageBytesHeld } from '@/server/core/billing/entitlements';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { publishProduct } from '@/server/modules/edge/publish';
import { handleDeleteLater } from '@/server/modules/tryon/retire';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext, systemContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { deleteModel, deleteVersion, listModels, publishVersion } from '@/server/modules/models/library';
import { processVersion } from '@/server/modules/models/process';
import { confirmUpload, modelVersionsOf, startUpload } from '@/server/modules/models/service';

setLogLevel('error');
const code = (e: any) => e.code;
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);

async function glb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
  const scene = doc.createScene();
  scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position))));
  doc.getRoot().setDefaultScene(scene);
  return new WebIO().writeBinary(doc);
}

async function merchant(harness: TestDb, name: string, role: 'owner' | 'analyst' = 'owner') {
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

/** Upload, confirm and process one version; returns its id. `bytes` defaults to a valid GLB. */
async function version(ctx: any, tenantId: string, target: { productId?: string; modelId?: string }, bytes?: Uint8Array) {
  const file = bytes ?? await glb();
  const started = await startUpload(ctx, { filename: 'm.glb', sizeBytes: file.byteLength, ...target });
  await storage().put(started.uploadUrl.replace('memory://upload/', ''), file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  await confirmUpload(ctx, started.versionId);
  await processVersion(tenantId, started.versionId, 'r');
  return started;
}

test('the list shows the live version\'s numbers; publishing moves the live version, and rolling back is publishing', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    const [product] = await admin(harness, () => harness.db.insert(products).values({ tenantId, name: 'Watch', nameAr: 'ساعة' } as any).returning()) as any[];
    const v1 = await version(ctx, tenantId, { productId: product.id });
    const v2 = await version(ctx, tenantId, { productId: product.id });

    let [row] = await listModels(ctx);
    assert.deepEqual([row.productName, row.productNameAr, row.status, row.version], ['Watch', 'ساعة', 'ready', 2], 'nothing live yet: the newest version is described; both names, the screen picks');
    assert.ok(row.sizeBytes > 0);
    assert.deepEqual(row.formats, ['glb']);

    await publishVersion(ctx, v2.versionId);
    await publishVersion(ctx, v1.versionId); // roll back
    [row] = await listModels(ctx);
    assert.equal(row.version, 1, 'the list follows the live version');
    const versions = await modelVersionsOf(ctx, v1.modelId);
    assert.deepEqual(versions.map((v) => [v.version, v.isCurrent]), [[2, false], [1, true]]);
    const live = versions.find((v) => v.isCurrent)!;
    assert.equal(row.sizeBytes, live.optimizedBytes, 'the size a shopper downloads: the optimised file, not the upload');
    assert.ok(live.optimizedBytes! !== live.originalBytes);

    const trail = await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.action, 'publish'))) as any[];
    assert.deepEqual(trail.map((r) => r.changes.after.version), [2, 1]);
    const trailBefore = trail.length;
    await publishVersion(ctx, v1.versionId);
    assert.equal((await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.action, 'publish')))).length, trailBefore, 'publishing the live version again records nothing');
  } finally { await harness.close(); }
});

test('only a ready version goes live; a new upload never replaces the live one', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    const good = await version(ctx, tenantId, {});
    await publishVersion(ctx, good.versionId);

    const pending = await startUpload(ctx, { filename: 'm.glb', sizeBytes: 100, modelId: good.modelId });
    await assert.rejects(() => publishVersion(ctx, pending.versionId), (e: any) => code(e) === 'conflict' && /draft/.test(e.message));
    const png = new Uint8Array(64).fill(7);
    const bad = await version(ctx, tenantId, { modelId: good.modelId }, png);
    await assert.rejects(() => publishVersion(ctx, bad.versionId), (e: any) => code(e) === 'conflict' && /failed/.test(e.message));

    const model = (await admin(harness, () => harness.db.select().from(models3d).where(eq(models3d.id, good.modelId))))[0] as any;
    assert.deepEqual([model.currentVersionId, model.status], [good.versionId, 'ready'], 'the live version and its status survive a failed upload');
    assert.equal((await listModels(ctx))[0].version, 1);
  } finally { await harness.close(); }
});

test('publishing needs models:publish; another store sees nothing and can publish nothing', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const a = await merchant(harness, 'alpha');
    const made = await version(a.ctx, a.tenantId, {});
    const analyst = await merchant(harness, 'gamma', 'analyst');
    await assert.rejects(() => publishVersion(analyst.ctx, made.versionId), (e: any) => code(e) === 'forbidden');

    const b = await merchant(harness, 'beta');
    assert.deepEqual(await listModels(b.ctx), []);
    await assert.rejects(() => publishVersion(b.ctx, made.versionId), (e: any) => code(e) === 'not_found');
    await assert.rejects(() => modelVersionsOf(b.ctx, made.modelId), (e: any) => code(e) === 'not_found');
  } finally { await harness.close(); }
});

test('T46: a version that is not live can be deleted — its files go and its storage is freed; the live one cannot', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    const v1 = await version(ctx, tenantId, {});
    const v2 = await version(ctx, tenantId, { modelId: v1.modelId });
    await publishVersion(ctx, v2.versionId);
    const before = await storageBytesHeld(ctx);
    const keysOf = async (versionId: string) => (await admin(harness, () => harness.db.select().from(modelFiles).where(eq(modelFiles.modelVersionId, versionId))) as any[]).map((f) => f.storageKey);
    const v1Keys = await keysOf(v1.versionId);
    assert.ok(v1Keys.length >= 2, 'the upload and its optimised file');

    await assert.rejects(deleteVersion(ctx, v2.versionId), (e: any) => code(e) === 'conflict' && /live version/.test(e.message));
    await deleteVersion(ctx, v1.versionId);
    assert.deepEqual((await modelVersionsOf(ctx, v1.modelId)).map((v) => v.version), [2], 'gone from the list');
    for (const key of v1Keys) assert.equal(await storage().head(key), null, `${key}: bytes deleted`);
    assert.ok((await storageBytesHeld(ctx)) < before, 'the storage it held is freed');
    await assert.rejects(deleteVersion(ctx, v1.versionId), (e: any) => code(e) === 'not_found', 'deleting twice');
    await assert.rejects(publishVersion(ctx, v1.versionId), (e: any) => code(e) === 'conflict', 'a deleted version cannot go live');
    const trail = (await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceType, 'model_version'))) as any[]).filter((r) => r.action === 'delete');
    assert.deepEqual(trail.map((r) => [r.resourceId, r.changes.after.archived]), [[v1.versionId, 1]], 'one delete, recorded with what it freed');
    const v3 = await version(ctx, tenantId, { modelId: v1.modelId });
    assert.deepEqual((await modelVersionsOf(ctx, v1.modelId)).map((v) => v.version), [3, 2], 'numbering carries on — v1 is never reused');

    void v3;
  } finally { await harness.close(); }
});

test('T46: deleting a model takes it off the shop first, keeps its files for shoppers holding the old config, then deletes them', async () => {
  const harness = await createTestDb();
  setStorage(new (class extends MemoryStorage { publicUrl(k: string) { return `https://cdn.example.test/${k}`; } })());
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    const [product] = await admin(harness, () => harness.db.insert(products).values({ tenantId, name: 'Vase', externalId: 'v-1', arEnabled: true, dimensions: { widthMm: 100, heightMm: 200 } } as any).returning()) as any[];
    const v1 = await version(ctx, tenantId, { productId: product.id });
    await publishVersion(ctx, v1.versionId);
    await publishProduct(ctx, product.id);
    assert.ok(kv.entries.get('alpha/v-1.json'));
    const keys = (await admin(harness, () => harness.db.select().from(modelFiles)) as any[]).map((f) => f.storageKey);
    const before = await storageBytesHeld(ctx);

    await deleteModel(ctx, v1.modelId);
    assert.deepEqual(await listModels(ctx), [], 'gone from the library');
    assert.equal(kv.entries.get('alpha/v-1.json'), undefined, 'nothing left to open → the button is withdrawn');
    for (const key of keys) assert.ok(await storage().head(key), `${key}: kept for shoppers still holding the old config`);
    assert.ok((await storageBytesHeld(ctx)) < before, 'the storage is freed at once');
    const later = await admin(harness, () => harness.db.select().from(jobs).where(eq(jobs.queue, 'storage.delete-later'))) as any[];
    assert.equal(later.length, keys.length);
    for (const job of later) await handleDeleteLater(job);
    for (const key of keys) assert.equal(await storage().head(key), null, `${key}: deleted after the grace period`);

    await assert.rejects(deleteModel(ctx, v1.modelId), (e: any) => code(e) === 'not_found');
    await assert.rejects(startUpload(ctx, { filename: 'm.glb', sizeBytes: 100, modelId: v1.modelId }), (e: any) => code(e) === 'not_found', 'a deleted model takes no uploads');
    const fresh = await startUpload(ctx, { filename: 'm.glb', sizeBytes: 100, productId: product.id });
    assert.notEqual(fresh.modelId, v1.modelId, 'a new upload for the product starts a new model');
  } finally { await harness.close(); }
});

test('T46: a version still being prepared cannot be deleted; an analyst can delete nothing', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId } = await merchant(harness, 'alpha');
    const file = await glb();
    const started = await startUpload(ctx, { filename: 'm.glb', sizeBytes: file.byteLength });
    await storage().put(started.uploadUrl.replace('memory://upload/', ''), file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    await confirmUpload(ctx, started.versionId); // processing, not yet optimised
    await assert.rejects(deleteVersion(ctx, started.versionId), (e: any) => code(e) === 'conflict' && /still being prepared/.test(e.message));
    await processVersion(tenantId, started.versionId, 'r');
    const reader = await (async () => {
      const userId = uuidv7();
      await admin(harness, async () => {
        await harness.db.insert(users).values({ id: userId, email: 'reader@example.test', passwordHash: 'x', fullName: 'r' } as any);
        await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId, role: 'analyst', status: 'active' } as any);
      });
      return buildTenantContext({ actor: { userId, email: 'reader@example.test', isStaff: false }, tenantId, requestId: 'r' });
    })();
    await assert.rejects(deleteVersion(reader, started.versionId), (e: any) => code(e) === 'forbidden');
    await assert.rejects(deleteModel(reader, started.modelId), (e: any) => code(e) === 'forbidden');
    const writeOnly = await systemContext({ tenantId, requestId: 'r', permissions: ['models:read', 'models:write'] });
    await assert.rejects(deleteModel(writeOnly, started.modelId), (e: any) => code(e) === 'forbidden', 'taking a model off the shop is a publish right too');
  } finally { await harness.close(); }
});
