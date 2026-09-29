/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P8 — where the events come from: a product added, changed or deleted in Tajribah, a 3D model
 * published, an AI job ending (done, failed, cancelled) — each announced once to the endpoints
 * that want it, with `data` exactly the documented v1 shape; and nothing is written when no
 * endpoint wants it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document, WebIO } from '@gltf-transform/core';
import { webhookDeliveries } from '@/db/schema';
import { AiJobV1, DeletedV1, ModelV1, ProductV1, WEBHOOK_DATA } from '@/lib/public-api/v1';
import { WEBHOOK_EVENTS } from '@/lib/webhooks';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, enablePlanFeature, seedTenant, type TestDb } from '@/server/testing/harness';
import { AiJobError, cancelAiJob, clearExecutors, createAiJob, registerExecutor, runAiJob } from '@/server/modules/ai-jobs/lifecycle';
import { publishVersion } from '@/server/modules/models/library';
import { processVersion } from '@/server/modules/models/process';
import { confirmUpload, startUpload } from '@/server/modules/models/service';
import { createEndpoint } from '@/server/modules/outgoing-webhooks/service';
import { createProduct, deleteProduct, updateProduct } from '@/server/modules/products/service';

setLogLevel('error');

async function glb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
  const scene = doc.createScene();
  scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position))));
  doc.getRoot().setDefaultScene(scene);
  return new WebIO().writeBinary(doc);
}

async function world(harness: TestDb, events: string[] = [...WEBHOOK_EVENTS]) {
  const seeded = await seedTenant(harness, 'alpha');
  for (const feature of ['public_api', 'ai_3d']) await enablePlanFeature(harness, 'starter', feature);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  if (events.length) await createEndpoint(ctx, { url: 'https://erp.example.sa/hooks', events });
  return { ...seeded, ctx };
}
const sent = async (harness: TestDb) => (await harness.asAdmin(() => harness.db.select().from(webhookDeliveries)) as any[])
  .sort((a, b) => a.id.localeCompare(b.id)).map((d) => [d.event, d.payload.data]);
const boot = () => { resetEnv(); loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) }); };

test('every event names a documented data shape', () => {
  assert.deepEqual(Object.keys(WEBHOOK_DATA).sort(), [...WEBHOOK_EVENTS].sort());
});

test('products added, changed and deleted in Tajribah are announced with their v1 shape', async () => {
  boot();
  const harness = await createTestDb();
  try {
    const a = await world(harness);
    const product = await createProduct(a.ctx, { name: 'Oyster 41', status: 'draft' });
    await updateProduct(a.ctx, product.id, { name: 'Oyster 41 Steel' });
    await deleteProduct(a.ctx, product.id);
    const events = await sent(harness);
    assert.deepEqual(events.map(([e]) => e), ['product.created', 'product.updated', 'product.deleted']);
    assert.equal(ProductV1.parse(events[0]![1]).name, 'Oyster 41');
    assert.equal(ProductV1.parse(events[1]![1]).name, 'Oyster 41 Steel');
    assert.deepEqual(DeletedV1.parse(events[2]![1]), { id: product.id });
  } finally { await harness.close(); resetEnv(); }
});

test('a published 3D model is announced as the v1 model', async () => {
  boot();
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  try {
    const a = await world(harness, ['model.published']);
    const file = await glb();
    const started = await startUpload(a.ctx, { filename: 'm.glb', sizeBytes: file.byteLength });
    await storage().put(started.uploadUrl.replace('memory://upload/', ''), file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    await confirmUpload(a.ctx, started.versionId);
    await processVersion(a.tenantId, started.versionId, 'r');
    await publishVersion(a.ctx, started.versionId);
    await publishVersion(a.ctx, started.versionId); // already live: nothing happens, nothing announced
    const events = await sent(harness);
    assert.deepEqual(events.map(([e]) => e), ['model.published']);
    const model = ModelV1.parse(events[0]![1]);
    assert.deepEqual([model.id, model.version, model.status], [started.modelId, 1, 'ready']);
  } finally { await harness.close(); resetEnv(); }
});

test('an AI job that ends — done, failed or cancelled — is announced once, as the v1 job', async () => {
  boot();
  clearExecutors();
  const harness = await createTestDb();
  try {
    const a = await world(harness, ['ai_job.finished']);
    registerExecutor('quality_check', async (job) => {
      if ((job.input as any).fail) throw new AiJobError('bad_input', 'unusable photos', { retryable: false });
      return { output: {} };
    });
    const run = (id: string) => runAiJob({ tenantId: a.tenantId, aiJobId: id, attempt: 1, maxAttempts: 1, requestId: 't' });
    const ok = await createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
    await run(ok.id);
    await run(ok.id); // a repeat delivery of a finished job: nothing more
    const bad = await createAiJob(a.ctx, { type: 'quality_check', input: { fail: true }, creditsCost: 1 });
    await run(bad.id);
    const stopped = await createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
    await cancelAiJob(a.ctx, stopped.id);

    const jobs = (await sent(harness)).map(([e, data]) => { assert.equal(e, 'ai_job.finished'); return AiJobV1.parse(data); });
    assert.deepEqual(jobs.map((j) => [j.id, j.status, j.refunded, j.errorCode]), [
      [ok.id, 'done', false, null],
      [bad.id, 'failed', true, 'bad_input'],
      [stopped.id, 'cancelled', true, null],
    ]);
  } finally { clearExecutors(); await harness.close(); resetEnv(); }
});

test('with no endpoint wanting it, nothing is written', async () => {
  boot();
  const harness = await createTestDb();
  try {
    const a = await world(harness, []);
    const product = await createProduct(a.ctx, { name: 'Quiet', status: 'draft' });
    await updateProduct(a.ctx, product.id, { name: 'Still quiet' });
    assert.deepEqual(await sent(harness), []);
  } finally { await harness.close(); resetEnv(); }
});
