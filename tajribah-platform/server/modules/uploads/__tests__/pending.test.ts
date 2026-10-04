/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Uploads started and never confirmed (try-on pictures, model pictures): after a day the sweep deletes
 * the bytes; a confirm after that, or of a key never handed out, is refused; bytes something attached
 * are never deleted, whatever a record says.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { models3d, pendingUploads, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, forTenant, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { confirmCutout, startCutoutUpload } from '@/server/modules/tryon/service';
import { confirmPicture, startPictureUpload } from '@/server/modules/models/picture';
import { EXPIRED, PENDING_UPLOAD_TTL_MS, sweepPendingUploads } from '@/server/modules/uploads/pending';

setLogLevel('error');
const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'server/modules/tryon/__tests__/fixtures', name)));
const later = (ms: number) => new Date(Date.now() + ms);

async function store(harness: TestDb, name: string) {
  setStorage(new MemoryStorage());
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const watch = uuidv7();
  const model = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(products).values({ id: watch, tenantId: seeded.tenantId, name: 'Steel field watch', productType: 'watch' } as any);
    await harness.db.insert(models3d).values({ id: model, tenantId: seeded.tenantId, name: 'Lamp', source: 'uploaded', status: 'ready' } as any);
  });
  return { ...seeded, ctx, watch, model, files: forTenant(seeded.tenantId) };
}

const records = (harness: TestDb) => harness.asAdmin(() => harness.db.select().from(pendingUploads));

test('a picture sent and never confirmed is deleted after a day; a confirm after that is refused', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, model, files } = await store(harness, 'alpha');
    const worn = fixture('worn.png');
    const cutout = await startCutoutUpload(ctx, watch, { slot: 'worn', filename: 'worn.png', contentType: 'image/png', sizeBytes: worn.length });
    await files.put(cutout.key, worn.slice().buffer as ArrayBuffer);
    const picture = await startPictureUpload(ctx, model, { contentType: 'image/png', sizeBytes: worn.length });
    await files.put(picture.key, worn.slice().buffer as ArrayBuffer);
    assert.deepEqual((await records(harness)).map((r: any) => r.purpose).sort(), ['model_picture', 'tryon_cutout']);

    assert.equal(await sweepPendingUploads(later(PENDING_UPLOAD_TTL_MS - 60_000)), 0, 'within the day nothing is touched: it may still be uploading');
    assert.ok(await files.head(cutout.key));

    assert.equal(await sweepPendingUploads(later(PENDING_UPLOAD_TTL_MS + 60_000)), 2);
    assert.equal(await files.head(cutout.key), null, 'the cut-out’s bytes are gone');
    assert.equal(await files.head(picture.key), null, 'the model picture’s bytes are gone');
    assert.deepEqual(await records(harness), []);

    await files.put(cutout.key, worn.slice().buffer as ArrayBuffer); // sent again to the old address
    await assert.rejects(() => confirmCutout(ctx, watch, { slot: 'worn', key: cutout.key }), (e: any) => e.code === 'conflict' && e.message === EXPIRED);
    await files.put(picture.key, worn.slice().buffer as ArrayBuffer);
    await assert.rejects(() => confirmPicture(ctx, model, { key: picture.key }), (e: any) => e.code === 'conflict' && e.message === EXPIRED);
  } finally { await harness.close(); }
});

test('a confirmed picture leaves no record and is kept; a key never handed out is refused; attached bytes survive a stale record', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, watch, model, files } = await store(harness, 'beta');
    const worn = fixture('worn.png');
    const cutout = await startCutoutUpload(ctx, watch, { slot: 'worn', filename: 'worn.png', contentType: 'image/png', sizeBytes: worn.length });
    await files.put(cutout.key, worn.slice().buffer as ArrayBuffer);
    await confirmCutout(ctx, watch, { slot: 'worn', key: cutout.key });
    const picture = await startPictureUpload(ctx, model, { contentType: 'image/png', sizeBytes: worn.length });
    await files.put(picture.key, worn.slice().buffer as ArrayBuffer);
    await confirmPicture(ctx, model, { key: picture.key });
    assert.deepEqual(await records(harness), [], 'confirm takes the record');

    // A key shaped exactly like a cut-out of this store, with bytes, but never started: not attached.
    const forged = files.key({ kind: 'photo', id: uuidv7(), filename: 'worn.png' });
    await files.put(forged, worn.slice().buffer as ArrayBuffer);
    await assert.rejects(() => confirmCutout(ctx, watch, { slot: 'worn', key: forged }), (e: any) => e.code === 'conflict' && e.message === EXPIRED);

    // Records left over for bytes that are attached: the sweep removes the records, never the bytes.
    await harness.asAdmin(() => harness.db.insert(pendingUploads).values([
      { id: uuidv7(), tenantId, storageKey: cutout.key, purpose: 'tryon_cutout' },
      { id: uuidv7(), tenantId, storageKey: picture.key, purpose: 'model_picture' },
    ] as any));
    assert.equal(await sweepPendingUploads(later(PENDING_UPLOAD_TTL_MS + 60_000)), 0);
    assert.ok(await files.head(cutout.key), 'the watch’s picture is kept');
    assert.ok(await files.head(picture.key), 'the model’s picture is kept');
    assert.deepEqual(await records(harness), []);
  } finally { await harness.close(); }
});
