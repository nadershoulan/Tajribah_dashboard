/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document, WebIO } from '@gltf-transform/core';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { configureNotify } from '@/server/core/notify/notify';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { createTestDb } from '@/server/testing/harness';
import { registerHandler } from '@/server/modules/auth/http';
import { processVersion } from '@/server/modules/models/process';
import { confirmUploadHandler, listModelsHandler, modelVersionsHandler, publishVersionHandler, startUploadHandler } from '@/server/modules/models/http';

setLogLevel('error');
const APP = 'http://localhost:5173';

test('over HTTP: upload → confirm → list → versions → publish, and the refusals', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  const original = console.log;
  try {
    console.log = () => {};
    const signup = await registerHandler(new Request(`${APP}/api/auth/register`, {
      method: 'POST', headers: { origin: APP, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'm@example.test', password: 'a-long-enough-password', fullName: 'M', storeName: 'Models' }),
    }));
    console.log = original;
    const { accessToken, tenant } = await signup.json() as any;
    const auth = { authorization: `Bearer ${accessToken}`, origin: APP };
    const post = (path: string, body?: unknown) => new Request(`${APP}${path}`, {
      method: 'POST', headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });

    const doc = new Document();
    const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(doc.createBuffer());
    const scene = doc.createScene();
    scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position))));
    doc.getRoot().setDefaultScene(scene);
    const bytes = await new WebIO().writeBinary(doc);

    const started = await startUploadHandler(post('/api/models/uploads', { filename: 'chair.glb', sizeBytes: bytes.byteLength }));
    assert.equal(started.status, 201);
    const s = await started.json() as any;
    await storage().put(s.uploadUrl.replace('memory://upload/', ''), bytes.buffer.slice(0) as ArrayBuffer);
    assert.equal((await (await confirmUploadHandler(post(`/api/models/versions/${s.versionId}/confirm`))).json() as any).status, 'processing');
    await processVersion(tenant.id, s.versionId, 'r');

    const list = await (await listModelsHandler(new Request(`${APP}/api/models`, { headers: auth }))).json() as any;
    assert.deepEqual([list.models[0].name, list.models[0].status, list.models[0].version], ['chair', 'ready', 1]);
    const versions = await (await modelVersionsHandler(new Request(`${APP}/api/models/${s.modelId}/versions`, { headers: auth }))).json() as any;
    assert.deepEqual(versions.versions.map((v: any) => [v.version, v.status, v.isCurrent]), [[1, 'ready', false]]);

    assert.equal((await publishVersionHandler(post(`/api/models/versions/${s.versionId}/publish`))).status, 204);
    const after = await (await modelVersionsHandler(new Request(`${APP}/api/models/${s.modelId}/versions`, { headers: auth }))).json() as any;
    assert.equal(after.versions[0].isCurrent, true);

    assert.equal((await publishVersionHandler(post('/api/models/versions/not-a-uuid/publish'))).status, 404);
    assert.equal((await modelVersionsHandler(new Request(`${APP}/api/models/not-a-uuid/versions`, { headers: auth }))).status, 404);
    assert.equal((await listModelsHandler(new Request(`${APP}/api/models`))).status, 401);
    const crossSite = new Request(`${APP}/api/models/versions/${s.versionId}/publish`, { method: 'POST', headers: { ...auth, origin: 'https://evil.example' } });
    assert.equal((await publishVersionHandler(crossSite)).status, 403);
  } finally { console.log = original; await harness.close(); resetEnv(); }
});
