/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P3.7 — the photo screen's two sources. The API source through the real `ApiClient`, the real
 * handlers and PGlite, the browser's PUT to storage the only stand-in; the preview source running
 * the same check in the browser. Both on real product photos, and both must answer alike.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiClient, ApiError } from '@/lib/api-client';
import { apiSource, demoSource, photoContentType } from '@/lib/data';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { configureNotify } from '@/server/core/notify/notify';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { createTestDb } from '@/server/testing/harness';
import * as auth from '@/server/modules/auth/http';
import * as products from '@/server/modules/products/http';
import * as ai from '@/server/modules/ai-jobs/http';

const APP = 'http://localhost:5173';
const bytes = (name: string) => readFileSync(join(process.cwd(), 'server/modules/ai-jobs/__tests__/fixtures', name));
const file = (name: string, type: string) => new File([bytes(name)], name, { type });

/** Same-origin fetch into the handlers, by method and path, with the refresh cookie jar. */
function browser() {
  const jar = new Map<string, string>();
  return (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, APP);
    const headers = new Headers(init.headers);
    headers.set('origin', APP);
    if (jar.size && url.pathname.startsWith('/api/auth')) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const method = (init.method ?? 'GET').toUpperCase();
    const parts = url.pathname.split('/').filter(Boolean);
    const handler =
      url.pathname === '/api/auth/register' ? auth.registerHandler
        : url.pathname === '/api/auth/me' ? auth.meHandler
          : url.pathname === '/api/products' && method === 'POST' ? products.createProductHandler
            : parts[3] === 'photos' && parts.length === 4 ? (method === 'POST' ? ai.startPhotoHandler : ai.listPhotosHandler)
              : parts[3] === 'photos' && parts[5] === 'confirm' ? ai.confirmPhotoHandler
                : parts[3] === 'photos' && parts.length === 5 && method === 'DELETE' ? ai.removePhotoHandler
                  : undefined;
    if (!handler) return new Response(null, { status: 404 });
    const response = await handler(new Request(url, { ...init, headers }));
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) { const [pair] = setCookie.split(';'); const [k, v] = pair.split('='); if (v) jar.set(k, v); }
    return response;
  }) as typeof fetch;
}

test('the API source: pick, upload straight to storage, see the verdict, remove — on real photos', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  setLogLevel('error');
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  // The browser's PUT to the presigned URL: the one thing not done by our code in production.
  const realFetch = globalThis.fetch;
  const puts: string[] = [];
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    if (!url.startsWith('memory://upload/') || init.method !== 'PUT') return realFetch(input, init);
    const key = url.slice('memory://upload/'.length);
    if (key.includes('expired')) return new Response('<Error>Request has expired</Error>', { status: 403 });
    puts.push(key);
    await storage().put(key, await new Response(init.body as BodyInit).arrayBuffer());
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const original = console.log;
  try {
    console.log = () => {};
    const client = new ApiClient(browser());
    await client.register({ email: 'o@example.test', password: 'a-long-enough-password', fullName: 'O', storeName: 'Oud House' });
    console.log = original;
    const source = apiSource(client);
    const product = await client.call<{ id: string }>('/api/products', { method: 'POST', body: { name: 'Watch', productType: 'watch' } });

    assert.deepEqual(await source.productPhotos(product.id), { photos: [], ready: false, missing: ['front', 'side', 'back'] });
    const front = await source.uploadProductPhoto(product.id, 'front', file('wrist-baseline.jpg', 'image/jpeg'));
    assert.deepEqual([front.status, front.format, front.width, front.height, front.score], ['accepted', 'jpeg', 1200, 1050, 75]);
    assert.equal(puts.length, 1, 'the bytes went to storage, not through the API');
    const back = await source.uploadProductPhoto(product.id, 'back', file('wrist-thumb.webp', 'image/webp'));
    assert.deepEqual([back.status, back.issues.map((i) => i.code)], ['rejected', ['too_small']]);

    const set = await source.productPhotos(product.id);
    assert.deepEqual([set.ready, set.missing, set.photos.length], [true, ['side', 'back'], 2]);

    await assert.rejects(() => source.uploadProductPhoto(product.id, 'front', file('wrist-lossy.webp', 'image/webp')),
      (e: any) => e instanceof ApiError && e.status === 409 && /already has a front photo/.test(e.message));
    await assert.rejects(() => source.uploadProductPhoto(product.id, 'side', new File([new Uint8Array(8)], 'IMG_0001.HEIC')),
      (e: any) => e instanceof ApiError && e.status === 422 && !!e.fields?.contentType, 'an iPhone HEIC is refused before a byte is sent');
    assert.equal(puts.length, 2);

    // Storage refuses the PUT (the link expired on a slow connection): the merchant is told, nothing is judged.
    await assert.rejects(() => source.uploadProductPhoto(product.id, 'side', new File([bytes('wrist-lossy.webp')], 'expired.webp', { type: 'image/webp' })),
      (e: any) => e instanceof ApiError && e.code === 'upload_failed' && e.status === 403);
    assert.equal((await source.productPhotos(product.id)).photos.find((p) => p.angle === 'side')?.status, 'uploading', 'left for the sweep, never accepted');

    await source.removeProductPhoto(product.id, front.id);
    assert.deepEqual((await source.productPhotos(product.id)).photos.filter((p) => p.status !== 'uploading').map((p) => p.id), [back.id]);
  } finally {
    console.log = original;
    globalThis.fetch = realFetch;
    await harness.close();
  }
});

test('the preview source runs the same check on the picked file, and refuses like the API', async () => {
  const [product] = (await demoSource.products()).rows;
  const id = product!.id;
  const front = await demoSource.uploadProductPhoto(id, 'front', file('wrist-progressive.jpg', 'image/jpeg'));
  assert.deepEqual([front.status, front.format, front.width, front.height, front.score], ['accepted', 'jpeg', 1200, 1050, 75]);
  assert.deepEqual(front.issues.map((i) => [i.code, i.blocking]), [['low_resolution', false]]);

  const same = await demoSource.uploadProductPhoto(id, 'detail', file('wrist-progressive.jpg', 'image/jpeg'));
  assert.deepEqual([same.status, same.issues[0]?.code], ['rejected', 'duplicate']);
  const tiny = await demoSource.uploadProductPhoto(id, 'back', file('watch-cutout.png', 'image/png'));
  assert.deepEqual([tiny.status, tiny.issues[0]?.code], ['rejected', 'too_small']);
  assert.match(tiny.issues[0]!.message.ar, /768/);

  await assert.rejects(() => demoSource.uploadProductPhoto(id, 'front', file('wrist-lossy.webp', 'image/webp')), (e: any) => e instanceof ApiError && e.status === 409);
  await assert.rejects(() => demoSource.uploadProductPhoto(id, 'side', new File([new Uint8Array(8)], 'IMG_0001.HEIC')), (e: any) => e instanceof ApiError && e.status === 422);
  await assert.rejects(() => demoSource.productPhotos('nope'), (e: any) => e instanceof ApiError && e.status === 404);

  const set = await demoSource.productPhotos(id);
  assert.deepEqual([set.ready, set.missing], [true, ['side', 'back']]);
  await demoSource.removeProductPhoto(id, front.id);
  assert.equal((await demoSource.productPhotos(id)).ready, false);
});

test('what the browser says a file is: its type, else its extension', () => {
  assert.equal(photoContentType(new File(['x'], 'a.png', { type: 'image/png' })), 'image/png');
  assert.equal(photoContentType(new File(['x'], 'IMG_0001.JPG')), 'image/jpeg');
  assert.equal(photoContentType(new File(['x'], 'IMG_0001.HEIC')), 'image/heic');
  assert.equal(photoContentType(new File(['x'], 'notes')), 'application/octet-stream');
});
