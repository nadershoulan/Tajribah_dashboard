/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P3.6 / A10 — the model QA queue: every generated model is looked at by a person before it can
 * go live (T25); an upload is not held. Decisions are recorded twice and the merchant is told;
 * a new version starts the review over; a decision on a version that is no longer the newest is
 * refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { Document, WebIO } from '@gltf-transform/core';
import { auditLogs, models3d, notifications, products, staffAudit, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { decideQa, qaModelFile, qaQueue } from '@/server/modules/admin/qa';
import { confirmUpload, startUpload } from '@/server/modules/models/service';
import { processVersion } from '@/server/modules/models/process';
import { listModels, publishVersion } from '@/server/modules/models/library';

setLogLevel('error');

/** A 1 × 1 unit quad grid: a stand-in for a generator's output, which has no size of its own. */
async function glb(n = 6): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions: number[] = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) positions.push(x / n, y / n, 0);
  const indices: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = y * (n + 1) + x; indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1); }
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer));
  const scene = doc.createScene();
  scene.addChild(doc.createNode('m').setMesh(doc.createMesh().addPrimitive(prim)));
  doc.getRoot().setDefaultScene(scene);
  return new WebIO().writeBinary(doc);
}

async function setup(harness: TestDb) {
  resetEnv();
  loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  setStorage(new MemoryStorage());
  const store = await seedTenant(harness, 'alpha');
  const ctx = await buildTenantContext({ actor: { userId: store.userId, email: store.email, isStaff: false }, tenantId: store.tenantId, requestId: 'r' });
  const staffId = uuidv7();
  await harness.asAdmin(() => harness.db.insert(users).values({ id: staffId, email: 'staff@tajribah.test', passwordHash: 'x', fullName: 'Staff', isStaff: true, totpEnabled: true } as any));
  const staff: StaffContext = { userId: staffId, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'staff-req' };
  return { ...store, ctx, staff };
}

/** One model version through the real path: upload → confirm → process. `generated` marks the model as generation made it. */
async function makeVersion(harness: TestDb, ctx: any, productId: string, generated: boolean) {
  const bytes = await glb();
  const started = await startUpload(ctx, { filename: 'model.glb', sizeBytes: bytes.byteLength, productId });
  await storage().put(started.uploadUrl.replace('memory://upload/', ''), bytes.slice().buffer as ArrayBuffer);
  if (generated) await harness.asAdmin(() => harness.db.update(models3d).set({ source: 'ai_generated' } as any).where(eq(models3d.id, started.modelId)));
  await confirmUpload(ctx, started.versionId);
  assert.equal(await processVersion(ctx.tenantId, started.versionId, 'r'), 'ready');
  return started;
}

test('a generated model waits in the queue, cannot go live until approved; a rejection is explained to the merchant', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, staff } = await setup(harness);
    const watch = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: watch, tenantId, name: 'Watch', dimensions: { widthMm: 40, heightMm: 40 } } as any));
    const v1 = await makeVersion(harness, ctx, watch, true);

    const queue = await qaQueue();
    assert.deepEqual(queue.counts, { pending: 1, approved: 0, rejected: 0 });
    const [row] = queue.rows;
    assert.deepEqual([row!.modelId, row!.version.id, row!.version.number, row!.store.id], [v1.modelId, v1.versionId, 1, tenantId]);
    assert.deepEqual(row!.version.sizeMm, [40, 40, 0], 'fitted to the product (P3.5) — what the reviewer checks against');
    assert.deepEqual(row!.product?.sizeMm, { widthMm: 40, heightMm: 40 });
    assert.ok(row!.version.webBytes! > 0);

    await assert.rejects(() => publishVersion(ctx, v1.versionId), (e: any) => e.code === 'conflict' && /waiting for review/.test(e.message));

    // An unmeasured product: post-processing leaves a note for staff, never shown to the merchant.
    const loose = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: loose, tenantId, name: 'Loose' } as any));
    const unsized = await makeVersion(harness, ctx, loose, true);
    const staffRow = (await qaQueue()).rows.find((r) => r.modelId === unsized.modelId);
    assert.match(staffRow!.qaNotes ?? '', /not sized: the product has no measurements/);
    assert.deepEqual((await listModels(ctx)).map((m) => m.qaNotes), [null, null], 'no note reaches the merchant while pending');
    await decideQa(staff, unsized.modelId, { decision: 'approved', versionId: unsized.versionId });

    await assert.rejects(() => decideQa(staff, v1.modelId, { decision: 'rejected', versionId: v1.versionId }), (e: any) => e.code === 'validation_failed', 'a rejection must say why');
    await decideQa(staff, v1.modelId, { decision: 'rejected', versionId: v1.versionId, notes: 'The strap is missing on the left side — retake the side photo.' });
    assert.deepEqual((await qaQueue('rejected')).counts, { pending: 0, approved: 1, rejected: 1 });
    await assert.rejects(() => publishVersion(ctx, v1.versionId), (e: any) => e.code === 'conflict' && /not approved in review/.test(e.message));
    const [listed] = await listModels(ctx);
    assert.deepEqual([listed!.qaStatus, listed!.qaNotes], ['rejected', 'The strap is missing on the left side — retake the side photo.']);

    // Recorded twice, and the merchant was told.
    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit).where(eq(staffAudit.targetId, v1.modelId)));
    assert.deepEqual(trail.map((t) => [t.action, t.storeId, t.reason]), [['model.qa_reject', tenantId, 'The strap is missing on the left side — retake the side photo.']]);
    const storeTrail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, v1.modelId), eq(auditLogs.actorType, 'staff'))));
    assert.equal(storeTrail.length, 1, 'the store’s own activity shows Tajribah staff');
    const told = await harness.asAdmin(() => harness.db.select().from(notifications).where(eq(notifications.tenantId, tenantId)));
    assert.ok(told.some((n: any) => n.type === 'model.qa_rejected'));

    // A new version starts the review over; a decision on the old one is refused.
    const v2 = await makeVersion(harness, ctx, watch, true);
    assert.equal(v2.modelId, v1.modelId);
    assert.deepEqual((await qaQueue()).rows.map((r) => [r.modelId, r.version.number]), [[v1.modelId, 2]]);
    await assert.rejects(() => decideQa(staff, v1.modelId, { decision: 'approved', versionId: v1.versionId }), (e: any) => e.code === 'conflict' && /newer version \(v2\)/.test(e.message));

    await decideQa(staff, v1.modelId, { decision: 'approved', versionId: v2.versionId });
    await publishVersion(ctx, v2.versionId);
    const live = (await listModels(ctx))[0]!;
    assert.deepEqual([live.qaStatus, live.qaNotes, live.version], ['approved', null, 2]);
    assert.ok((await harness.asAdmin(() => harness.db.select().from(notifications).where(eq(notifications.tenantId, tenantId)))).some((n: any) => n.type === 'model.qa_approved'));
  } finally { await harness.close(); }
});

test('an upload is never held or queued; the reviewer’s file is the web GLB, and only a ready version has one', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, staff } = await setup(harness);
    const ring = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: ring, tenantId, name: 'Ring' } as any));
    const own = await makeVersion(harness, ctx, ring, false);
    assert.deepEqual((await qaQueue()).counts, { pending: 0, approved: 0, rejected: 0 });
    assert.deepEqual((await qaQueue()).rows, [], 'an upload is pending by default, and still never listed');
    await publishVersion(ctx, own.versionId); // not held
    await assert.rejects(() => decideQa(staff, own.modelId, { decision: 'approved', versionId: own.versionId }), (e: any) => e.code === 'conflict' && /only generated models/.test(e.message));

    const file = await qaModelFile(own.versionId);
    const bytes = new Uint8Array(await new Response(file.body).arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'glTF');
    assert.equal(bytes.byteLength, file.size);
    await assert.rejects(() => qaModelFile(uuidv7()), (e: any) => e.code === 'not_found');
  } finally { await harness.close(); }
});
