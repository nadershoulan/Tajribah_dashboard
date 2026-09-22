/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryStorage, R2Storage, configureStorage, forTenant, key, keyBelongsTo, storage,
  type Storage,
} from '@/server/core/storage/storage';
import { presignUrl } from '@/server/core/storage/sigv4';
import { loadEnv, resetEnv } from '@/server/core/config/env';

const A = '01a0caa1-0000-7000-8000-00000000000a';
const B = '01a0caa1-0000-7000-8000-00000000000b';
const MODEL_ID = '01a0caa1-0000-7000-8000-0000000000aa';

/**
 * Just enough of the Workers `R2Bucket` to run `R2Storage` in Node. It stores what it is
 * given and answers the way R2 does, so the adapter's mapping is exercised, not mocked out.
 */
class FakeR2Bucket {
  objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; httpMetadata: any; uploaded: Date }>();
  async put(k: string, body: any, options: any = {}) {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    const uploaded = new Date();
    this.objects.set(k, { bytes, httpMetadata: options.httpMetadata ?? {}, uploaded });
    return { key: k, size: bytes.byteLength, etag: `etag-${bytes.byteLength}`, uploaded };
  }
  private view(k: string) {
    const o = this.objects.get(k);
    return o && { key: k, size: o.bytes.byteLength, etag: `etag-${o.bytes.byteLength}`, httpMetadata: o.httpMetadata, uploaded: o.uploaded };
  }
  async get(k: string) {
    const o = this.objects.get(k);
    return o ? { ...this.view(k), body: new Response(o.bytes).body } : null;
  }
  async head(k: string) { return this.view(k) ?? null; }
  async delete(k: string) { this.objects.delete(k); }
  async list({ prefix, limit }: { prefix: string; limit: number }) {
    return { objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((k) => this.view(k)) };
  }
}

const S3 = { accountId: 'acct123', bucketName: 'tajribah-assets', accessKeyId: 'AKID', secretAccessKey: 'secret' };

const backends: [string, () => Storage][] = [
  ['memory', () => new MemoryStorage()],
  ['r2', () => new R2Storage(new FakeR2Bucket() as any, 'https://cdn.example.test/', S3)],
];

const readAll = async (stream: ReadableStream) => new Uint8Array(await new Response(stream).arrayBuffer());

test('SigV4 presigning matches the AWS documentation example', async () => {
  // "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)", S3 API reference.
  const url = await presignUrl({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    expiresInSeconds: 86400,
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(new URL(url).searchParams.get('X-Amz-Signature'),
    'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

for (const [name, make] of backends) {
  test(`${name}: upload and read back through the adapter`, async () => {
    const files = forTenant(A, make());
    const bytes = new Uint8Array(4096).map((_, i) => (i * 31) % 256); // stand-in for a GLB
    const modelKey = files.key({ kind: 'model', id: MODEL_ID, filename: 'Oyster 41.glb', version: 3 });
    assert.equal(modelKey, `t/${A}/model/${MODEL_ID}/v3/Oyster-41.glb`);

    // A stream, which is how a Worker route receives an upload.
    const stored = await files.put(modelKey, new Response(bytes.buffer as ArrayBuffer).body!, { contentType: 'model/gltf-binary', immutable: true });
    assert.equal(stored.size, 4096);

    const back = await files.get(modelKey);
    assert.ok(back);
    assert.deepEqual(await readAll(back.body), bytes, 'the bytes read back are the bytes written');
    assert.equal(back.meta.contentType, 'model/gltf-binary');
    assert.equal((await files.head(modelKey))?.size, 4096);

    await files.put(files.key({ kind: 'photo', id: MODEL_ID, filename: 'front.jpg' }), 'jpeg-bytes');
    assert.equal((await files.list()).length, 2);
    assert.equal((await files.list('model')).length, 1);

    await files.delete(modelKey);
    assert.equal(await files.get(modelKey), null);
  });

  test(`${name}: one tenant cannot reach another tenant's files`, async () => {
    const backend = make();
    const a = forTenant(A, backend);
    const b = forTenant(B, backend);
    const bKey = b.key({ kind: 'model', id: MODEL_ID, filename: 'secret.glb' });
    await b.put(bKey, 'B only');

    for (const attempt of [
      () => a.get(bKey), () => a.head(bKey), () => a.delete(bKey), () => a.put(bKey, 'overwrite'),
      () => a.presignUpload(bKey), async () => a.publicUrl(bKey),
      // Starts with A's prefix; a CDN or browser would normalise it into B's folder.
      () => a.get(`t/${A}/../${B}/model/${MODEL_ID}/secret.glb`),
      () => a.get(`t/${A}//x`),
    ]) {
      await assert.rejects(attempt, /not found/);
    }
    assert.equal((await a.list()).length, 0, "A's listing must not include B's files");
    assert.equal(await readAll((await b.get(bKey))!.body).then((u) => new TextDecoder().decode(u)), 'B only');
  });
}

test('keys cannot be built from unsafe parts', () => {
  assert.throws(() => key({ tenantId: '../x', kind: 'model', id: MODEL_ID, filename: 'a.glb' }), /unsafe/);
  assert.throws(() => key({ tenantId: A, kind: 'model', id: 'a/b', filename: 'a.glb' }), /unsafe/);
  const k = key({ tenantId: A, kind: 'photo', id: MODEL_ID, filename: '../../ساعة ذهبية..jpg' });
  assert.ok(!k.includes('..'), k);
  assert.ok(keyBelongsTo(k, A));
  assert.equal(keyBelongsTo(k, ''), false);
});

test('R2 presigns a PUT for exactly one key, with the content type bound and at most an hour', async () => {
  const files = forTenant(A, new R2Storage(new FakeR2Bucket() as any, 'https://cdn.example.test', S3));
  const k = files.key({ kind: 'model', id: MODEL_ID, filename: 'm.glb', version: 1 });
  const { url, expiresAt } = await files.presignUpload(k, { contentType: 'model/gltf-binary', expiresInSeconds: 999_999 });
  const parsed = new URL(url);
  assert.equal(parsed.host, 'acct123.r2.cloudflarestorage.com');
  assert.equal(parsed.pathname, `/tajribah-assets/${k}`);
  assert.equal(parsed.searchParams.get('X-Amz-Expires'), '3600');
  assert.equal(parsed.searchParams.get('X-Amz-SignedHeaders'), 'content-type;host');
  assert.match(parsed.searchParams.get('X-Amz-Credential')!, /^AKID\/\d{8}\/auto\/s3\/aws4_request$/);
  assert.ok(expiresAt.getTime() - Date.now() <= 3600_000 + 1000);
  assert.equal(files.publicUrl(k), `https://cdn.example.test/${k}`);

  const noCreds = forTenant(A, new R2Storage(new FakeR2Bucket() as any, 'https://cdn.example.test'));
  await assert.rejects(() => noCreds.presignUpload(k), /S3 credentials/);
});

test('configureStorage picks the adapter, and the env refuses unsafe combinations', () => {
  configureStorage({ STORAGE_PROVIDER: 'memory' });
  assert.ok(storage() instanceof MemoryStorage);
  assert.throws(() => configureStorage({ STORAGE_PROVIDER: 'r2', CDN_BASE_URL: 'https://cdn.example.test' }), /BUCKET/);
  configureStorage({ STORAGE_PROVIDER: 'r2', CDN_BASE_URL: 'https://cdn.example.test' }, new FakeR2Bucket() as any);
  assert.ok(storage() instanceof R2Storage);
  configureStorage({ STORAGE_PROVIDER: 'memory' });

  const base = { APP_URL: 'http://localhost:5173', AUTH_SECRET: 'x'.repeat(32), ENCRYPTION_KEY: 'y'.repeat(32) };
  resetEnv();
  assert.throws(() => loadEnv({ ...base, NODE_ENV: 'production' }), /STORAGE_PROVIDER: memory storage is not allowed in production/);
  resetEnv();
  assert.throws(() => loadEnv({ ...base, STORAGE_PROVIDER: 'r2' }), /CDN_BASE_URL: required when STORAGE_PROVIDER=r2/);
  resetEnv();
  assert.equal(loadEnv(base).STORAGE_PROVIDER, 'memory');
  resetEnv();
});
