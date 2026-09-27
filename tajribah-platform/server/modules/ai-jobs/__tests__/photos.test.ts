/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P3.3 — product photos for generation: the bytes decide, one photo per angle, refused bytes
 * deleted at once, photos count against storage, and nothing is left by an abandoned upload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { generationPhotos, products, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { storageBytesHeld } from '@/server/core/billing/entitlements';
import { configureNotify } from '@/server/core/notify/notify';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { forTenant, MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext, type TenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { registerHandler as registerAccount } from '@/server/modules/auth/http';
import { confirmPhoto, listPhotos, removePhoto, startPhotoUpload } from '@/server/modules/ai-jobs/photos';
import { PHOTO_UPLOAD_TTL_MS, sweepUnconfirmedPhotos } from '@/server/modules/ai-jobs/sweep';
import { confirmPhotoHandler, listPhotosHandler, removePhotoHandler, startPhotoHandler } from '@/server/modules/ai-jobs/http';

setLogLevel('error');
const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'server/modules/ai-jobs/__tests__/fixtures', name)));
const JPEG = fixture('wrist-baseline.jpg');
const WEBP = fixture('wrist-lossy.webp');
const PROGRESSIVE = fixture('wrist-progressive.jpg');
const THUMB = fixture('wrist-thumb.webp');

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  const productId = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values({ id: productId, tenantId: seeded.tenantId, name: 'Watch' } as any));
  return { ...seeded, ctx, productId };
}

/** Start, send the bytes where the presigned URL points, confirm — as the browser would. */
async function upload(ctx: TenantContext, productId: string, angle: 'front' | 'side' | 'back' | 'detail', bytes: Uint8Array, contentType = 'image/jpeg') {
  const started = await startPhotoUpload(ctx, productId, { angle, filename: `${angle}.jpg`, contentType, sizeBytes: bytes.length });
  const key = await keyOf(ctx, started.photoId);
  await forTenant(ctx.tenantId).put(key, bytes.slice().buffer, { contentType });
  return { started, verdict: await confirmPhoto(ctx, productId, started.photoId), key };
}
async function keyOf(ctx: TenantContext, photoId: string) {
  return (await ctx.db.findById(generationPhotos, photoId))!.storageKey;
}

test('front, side and details accepted from the bytes; a generation is ready once there is a front', async () => {
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  try {
    const { ctx, productId } = await store(harness, 'alpha');
    assert.deepEqual(await listPhotos(ctx, productId), { photos: [], ready: false, missing: ['front', 'side', 'back'] });

    const front = await upload(ctx, productId, 'front', JPEG);
    assert.deepEqual([front.verdict.status, front.verdict.format, front.verdict.width, front.verdict.height], ['accepted', 'jpeg', 1200, 1050]);
    assert.deepEqual(front.verdict.issues.map((i) => [i.code, i.blocking]), [['low_resolution', false]]);
    assert.equal(front.verdict.score, 75);
    // Declared as a JPEG, really a WebP: the bytes decide.
    const side = await upload(ctx, productId, 'side', WEBP, 'image/jpeg');
    assert.deepEqual([side.verdict.status, side.verdict.format], ['accepted', 'webp']);
    for (let i = 0; i < 3; i++) {
      const detail = await upload(ctx, productId, 'detail', i === 0 ? PROGRESSIVE : fixture(i === 1 ? 'lifestyle-extended.webp' : 'thumb-lossless.webp'), 'image/webp');
      assert.equal(detail.verdict.status, i === 2 ? 'rejected' : 'accepted', `detail ${i}`);
    }

    const set = await listPhotos(ctx, productId);
    assert.deepEqual([set.ready, set.missing], [true, ['back']]);
    assert.equal(set.photos.length, 5);

    await assert.rejects(() => upload(ctx, productId, 'front', WEBP), (e: any) => e.code === 'conflict' && /already has a front photo/.test(e.message), 'one photo per angle, never silently replaced');
    // Two details accepted, one refused: the refused one does not hold a slot, so one more may start…
    await startPhotoUpload(ctx, productId, { angle: 'detail', filename: 'd.jpg', contentType: 'image/jpeg', sizeBytes: 10 });
    // …and then all three are taken (an upload in flight holds its slot).
    await assert.rejects(() => startPhotoUpload(ctx, productId, { angle: 'detail', filename: 'e.jpg', contentType: 'image/jpeg', sizeBytes: 10 }), (e: any) => e.code === 'conflict' && /already has 3 detail photos/.test(e.message));
  } finally { await harness.close(); }
});

test('refused bytes are deleted at once, the angle is freed, duplicates and early confirms are refused, confirm is idempotent', async () => {
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  try {
    const { ctx, productId } = await store(harness, 'alpha');
    const small = await upload(ctx, productId, 'side', THUMB, 'image/webp');
    assert.deepEqual([small.verdict.status, small.verdict.issues[0]?.code, small.verdict.issues[0]?.blocking], ['rejected', 'too_small', true]);
    assert.match(small.verdict.issues[0]!.message.ar, /768/);
    assert.equal(await forTenant(ctx.tenantId).head(small.key), null, 'we never keep bytes we refused');
    assert.ok((await ctx.db.findById(generationPhotos, small.started.photoId))!.bytesDeletedAt);
    assert.equal((await upload(ctx, productId, 'side', WEBP, 'image/webp')).verdict.status, 'accepted', 'a refused photo does not hold its angle');

    const front = await upload(ctx, productId, 'front', JPEG);
    const again = await upload(ctx, productId, 'back', JPEG);
    assert.deepEqual([again.verdict.status, again.verdict.issues.map((i) => i.code)], ['rejected', ['duplicate']]);
    assert.deepEqual(await confirmPhoto(ctx, productId, front.started.photoId), front.verdict, 'confirming again answers the same');

    const early = await startPhotoUpload(ctx, productId, { angle: 'back', filename: 'b.jpg', contentType: 'image/jpeg', sizeBytes: 100 });
    await assert.rejects(() => confirmPhoto(ctx, productId, early.photoId), (e: any) => e.code === 'conflict' && /not arrived/.test(e.message));
    await assert.rejects(() => startPhotoUpload(ctx, productId, { angle: 'back', filename: 'x.heic', contentType: 'image/heic', sizeBytes: 100 }), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => startPhotoUpload(ctx, productId, { angle: 'back', filename: 'x.jpg', contentType: 'image/jpeg', sizeBytes: 21 * 1024 * 1024 }), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => startPhotoUpload(ctx, uuidv7(), { angle: 'front', filename: 'x.jpg', contentType: 'image/jpeg', sizeBytes: 100 }), (e: any) => e.code === 'not_found');
  } finally { await harness.close(); }
});

test('photos count against storage from the start; removing one frees its bytes, its angle and its storage', async () => {
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  try {
    const { ctx, productId } = await store(harness, 'alpha');
    const before = await storageBytesHeld(ctx);
    const started = await startPhotoUpload(ctx, productId, { angle: 'front', filename: 'f.jpg', contentType: 'image/jpeg', sizeBytes: 5_000_000 });
    assert.equal(await storageBytesHeld(ctx), before + 5_000_000, 'an upload in flight holds what it declared');
    await forTenant(ctx.tenantId).put(await keyOf(ctx, started.photoId), JPEG.slice().buffer);
    await confirmPhoto(ctx, productId, started.photoId);
    assert.equal(await storageBytesHeld(ctx), before + JPEG.length, 'corrected to what arrived');

    const key = await keyOf(ctx, started.photoId);
    await removePhoto(ctx, productId, started.photoId);
    assert.equal(await forTenant(ctx.tenantId).head(key), null);
    assert.equal(await storageBytesHeld(ctx), before);
    assert.equal((await listPhotos(ctx, productId)).photos.length, 0);
    assert.equal((await upload(ctx, productId, 'front', JPEG)).verdict.status, 'accepted', 'the angle is free again');
  } finally { await harness.close(); }
});

test('who may do what: an analyst can look but not upload; another store sees nothing', async () => {
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, productId } = await store(harness, 'alpha');
    const other = await store(harness, 'bravo');
    const analystId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: analystId, email: 'an@example.test', passwordHash: 'pbkdf2$sha256$1$x$x', fullName: 'A' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId: analystId, role: 'analyst', status: 'active' } as any);
    });
    const analyst = await buildTenantContext({ actor: { userId: analystId, email: 'an@example.test', isStaff: false }, tenantId, requestId: 'r' });
    const { started } = await upload(ctx, productId, 'front', JPEG);

    assert.equal((await listPhotos(analyst, productId)).photos.length, 1);
    await assert.rejects(() => startPhotoUpload(analyst, productId, { angle: 'side', filename: 's.jpg', contentType: 'image/jpeg', sizeBytes: 10 }), (e: any) => e.code === 'forbidden');
    await assert.rejects(() => removePhoto(analyst, productId, started.photoId), (e: any) => e.code === 'forbidden');
    await assert.rejects(() => listPhotos(other.ctx, productId), (e: any) => e.code === 'not_found');
    await assert.rejects(() => confirmPhoto(other.ctx, productId, started.photoId), (e: any) => e.code === 'not_found');
    await assert.rejects(() => removePhoto(other.ctx, other.productId, started.photoId), (e: any) => e.code === 'not_found', 'another store cannot reach it through its own product');
    // Same store, the wrong product: the photo belongs to the product in the address, or it is a 404.
    const second = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: second, tenantId, name: 'Ring' } as any));
    await assert.rejects(() => removePhoto(ctx, second, started.photoId), (e: any) => e.code === 'not_found');
    await assert.rejects(() => confirmPhoto(ctx, second, started.photoId), (e: any) => e.code === 'not_found');
    assert.equal((await listPhotos(ctx, productId)).photos.length, 1, 'still there');
  } finally { await harness.close(); }
});

test('the sweep removes uploads never confirmed, and nothing else', async () => {
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  try {
    const { ctx, productId } = await store(harness, 'alpha');
    const abandoned = await startPhotoUpload(ctx, productId, { angle: 'back', filename: 'b.jpg', contentType: 'image/jpeg', sizeBytes: 100 });
    const abandonedKey = await keyOf(ctx, abandoned.photoId);
    await forTenant(ctx.tenantId).put(abandonedKey, WEBP.slice().buffer); // arrived, never confirmed
    const recent = await startPhotoUpload(ctx, productId, { angle: 'side', filename: 's.jpg', contentType: 'image/jpeg', sizeBytes: 100 });
    const kept = await upload(ctx, productId, 'front', JPEG);
    const old = new Date(Date.now() - PHOTO_UPLOAD_TTL_MS - 60_000);
    await harness.asAdmin(() => harness.db.update(generationPhotos).set({ createdAt: old } as any).where(eq(generationPhotos.id, abandoned.photoId)));
    await harness.asAdmin(() => harness.db.update(generationPhotos).set({ createdAt: old } as any).where(eq(generationPhotos.id, kept.started.photoId)));

    assert.equal(await sweepUnconfirmedPhotos(), 1);
    assert.equal(await forTenant(ctx.tenantId).head(abandonedKey), null);
    const left = (await listPhotos(ctx, productId)).photos.map((p) => p.id).sort();
    assert.deepEqual(left, [recent.photoId, kept.started.photoId].sort(), 'an accepted photo and a fresh upload stay, however old');
    assert.ok(await forTenant(ctx.tenantId).head(kept.key), 'and the accepted photo keeps its bytes');
  } finally { await harness.close(); }
});

test('over HTTP: start, confirm, list, remove — and the refusals', async () => {
  setStorage(new MemoryStorage());
  resetEnv();
  const APP = 'http://localhost:5173';
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  const harness = await createTestDb();
  const original = console.log;
  try {
    console.log = () => {};
    const response = await registerAccount(new Request(`${APP}/api/auth/register`, {
      method: 'POST', headers: { origin: APP, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'o@example.test', password: 'a-long-enough-password', fullName: 'O', storeName: 'Alpha' }),
    }));
    console.log = original;
    const body = await response.json() as any;
    const auth = { authorization: `Bearer ${body.accessToken}`, origin: APP };
    const ctx = await buildTenantContext({ actor: { userId: body.user.id, email: 'o@example.test', isStaff: false }, tenantId: body.tenant.id, requestId: 'r' });
    const productId = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: productId, tenantId: body.tenant.id, name: 'Watch' } as any));
    const base = `${APP}/api/products/${productId}/photos`;

    const start = await startPhotoHandler(new Request(base, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ angle: 'front', filename: 'f.jpg', contentType: 'image/jpeg', sizeBytes: JPEG.length }) }));
    assert.equal(start.status, 201);
    const { photoId, uploadUrl } = await start.json() as any;
    assert.ok(uploadUrl);
    await forTenant(ctx.tenantId).put(await keyOf(ctx, photoId), JPEG.slice().buffer);
    const confirmed = await confirmPhotoHandler(new Request(`${base}/${photoId}/confirm`, { method: 'POST', headers: auth }));
    assert.equal(((await confirmed.json()) as any).status, 'accepted');
    const listed = await (await listPhotosHandler(new Request(base, { headers: auth }))).json() as any;
    assert.deepEqual([listed.ready, listed.photos.length], [true, 1]);

    assert.equal((await removePhotoHandler(new Request(`${base}/${photoId}`, { method: 'DELETE', headers: { ...auth, origin: 'https://evil.example' } }))).status, 403);
    assert.equal((await removePhotoHandler(new Request(`${base}/${photoId}`, { method: 'DELETE', headers: auth }))).status, 204);
    assert.equal((await confirmPhotoHandler(new Request(`${base}/not-a-uuid/confirm`, { method: 'POST', headers: auth }))).status, 404);
    assert.equal((await listPhotosHandler(new Request(base))).status, 401);
    const bad = await startPhotoHandler(new Request(base, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ angle: 'top', filename: 'f.jpg', contentType: 'image/jpeg', sizeBytes: 10 }) }));
    assert.equal(bad.status, 422);
  } finally { console.log = original; await harness.close(); }
});
