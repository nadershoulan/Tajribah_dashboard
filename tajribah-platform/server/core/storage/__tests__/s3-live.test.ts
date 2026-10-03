/**
 * T57 — the S3 adapter against a real S3 server (skipped unless S3_LIVE_ENDPOINT is set): a bucket
 * that checks every signature — SeaweedFS locally (docs/DATABASE.md has the recipe), or R2 itself.
 * Put, head, get back byte for byte, list by prefix, a presigned PUT from "the browser", delete; and a
 * request signed with the wrong secret is refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S3Storage } from '@/server/core/storage/storage';
import { signRequest } from '@/server/core/storage/sigv4';

const endpoint = process.env.S3_LIVE_ENDPOINT;
const config = {
  endpoint: endpoint ?? '', region: process.env.S3_LIVE_REGION ?? 'us-east-1', bucket: process.env.S3_LIVE_BUCKET ?? 'tajribah-live',
  accessKeyId: process.env.S3_LIVE_KEY ?? '', secretAccessKey: process.env.S3_LIVE_SECRET ?? '', cdnBaseUrl: 'https://cdn.example.test',
};

test('the S3 adapter against a real bucket', { skip: !endpoint && 'set S3_LIVE_ENDPOINT (and _KEY, _SECRET, _BUCKET)' }, async () => {
  // The bucket, created with a signed request of our own (SeaweedFS answers 200, or 409 when it exists).
  const bucketUrl = new URL(`${endpoint!.replace(/\/$/, '')}/${config.bucket}`);
  const made = await fetch(bucketUrl, { method: 'PUT', headers: await signRequest({ method: 'PUT', url: bucketUrl, region: config.region, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }) });
  assert.ok([200, 409].includes(made.status), `create bucket: ${made.status} ${await made.text()}`);

  const store = new S3Storage(config);
  const k = `t/0192b000-0000-7000-8000-00000000000a/model/m1/v1/watch ساعة.glb`;
  const bytes = new Uint8Array(3000).map((_, i) => (i * 37) % 256);
  const put = await store.put(k, bytes.buffer as ArrayBuffer, { contentType: 'model/gltf-binary', immutable: true });
  assert.equal(put.size, 3000);
  const head = await store.head(k);
  assert.deepEqual([head?.size, head?.contentType], [3000, 'model/gltf-binary']);
  const got = await store.get(k);
  assert.deepEqual(new Uint8Array(await new Response(got!.body).arrayBuffer()), bytes, 'back byte for byte (an Arabic key too)');
  const listed = await store.list('t/0192b000-0000-7000-8000-00000000000a/model/');
  assert.ok(listed.some((o) => o.key === k && o.size === 3000), JSON.stringify(listed));
  assert.equal(await store.head(`${k}.missing`), null);
  assert.equal(await store.get(`${k}.missing`), null);

  // The browser's upload, to a presigned address, with the type it was signed for.
  const k2 = 't/0192b000-0000-7000-8000-00000000000a/photo/p1/front.jpg';
  const { url } = await store.presignUpload(k2, { contentType: 'image/jpeg', sizeBytes: 4 });
  // Pre-launch review: a body of another size than the one signed is refused, nothing stored.
  const bigger = await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(4096) });
  assert.equal(bigger.status, 403, `a bigger body: ${bigger.status} ${await bigger.text()}`);
  assert.equal(await store.head(k2), null);
  const uploaded = await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array([255, 216, 255, 224]) });
  assert.equal(uploaded.status, 200, await uploaded.text());
  assert.equal((await store.head(k2))?.size, 4);

  // Signed with the wrong secret: refused, loudly.
  const wrong = new S3Storage({ ...config, secretAccessKey: 'not-the-secret' });
  await assert.rejects(() => wrong.head(k), /403|SignatureDoesNotMatch|AccessDenied/);

  await store.delete(k);
  await store.delete(k2);
  assert.equal(await store.head(k), null);
});
