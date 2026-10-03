/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T68 — calibration: the merchant marks the case's edges on a try-on picture and it is cropped to
 * them. The case here is the studio's own flat shot; the "crown" is a solid block beside it, which the
 * alpha check cannot tell from the case (it reads 100%) — the reason a merchant's marks are needed.
 * Cropped to the marks, the picture is the studio's own shot again, pixel for pixel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { auditLogs, jobs, products, subscriptions, tenantMemberships, tryonConfigs, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { CALIBRATE_MIN_PX, calibrationCrop } from '@/lib/tryon-quality';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, forTenant, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import { calibrateCutout, checkCutoutQuality, handleQualityJob } from '@/server/modules/tryon/quality';
import { calibrateCutoutEdges, confirmCutout, startCutoutUpload, tryOnScreen } from '@/server/modules/tryon/service';

setLogLevel('error');
const FLAT = new Uint8Array(readFileSync(join(process.cwd(), 'server/modules/tryon/__tests__/fixtures', 'flat.png'))); // 95 × 213
const CROWN = 12;

/** The real flat shot with a solid 12 × 24 "crown" against its right edge, half way down — built pixel by pixel. */
async function crowned(format: 'png' | 'webp' = 'png'): Promise<Uint8Array> {
  const { data, info } = await sharp(FLAT).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width + CROWN;
  const out = Buffer.alloc(W * info.height * 4);
  for (let y = 0; y < info.height; y++) {
    data.copy(out, y * W * 4, y * info.width * 4, (y + 1) * info.width * 4);
    if (y >= 95 && y < 95 + 24) for (let x = info.width; x < W; x++) out.set([120, 110, 90, 255], (y * W + x) * 4);
  }
  const img = sharp(out, { raw: { width: W, height: info.height, channels: 4 } });
  return new Uint8Array(await (format === 'webp' ? img.webp({ lossless: true, exact: true }) : img.png()).toBuffer());
}
const pixels = async (bytes: Uint8Array) => sharp(bytes).ensureAlpha().raw().toBuffer();
const bytesAt = async (tenantId: string, key: string) => new Uint8Array(await new Response((await forTenant(tenantId).get(key))!.body).arrayBuffer());
const configOf = (harness: TestDb, productId: string) => harness.asAdmin(async () => (await harness.db.select().from(tryonConfigs).where(eq(tryonConfigs.productId, productId)))[0]!);

async function store(harness: TestDb, name: string) {
  setStorage(new MemoryStorage());
  const seeded = await seedTenant(harness, name);
  const planId = await seededPlanId(harness, 'pro');
  const now = new Date();
  await harness.asAdmin(() => harness.db.insert(subscriptions).values({ id: uuidv7(), tenantId: seeded.tenantId, planId, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) } as any));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const watch = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values({ id: watch, tenantId: seeded.tenantId, name: 'Steel field watch', productType: 'watch' } as any));
  return { ...seeded, ctx, watch };
}

/** Upload and check a picture, as the screen sees it afterwards: its current key. */
async function uploaded(ctx: any, productId: string, bytes: Uint8Array, contentType = 'image/png'): Promise<string> {
  const started = await startCutoutUpload(ctx, productId, { slot: 'flat', filename: 'flat.png', contentType, sizeBytes: bytes.length });
  await forTenant(ctx.tenantId).put(started.key, bytes.slice().buffer as ArrayBuffer);
  await confirmCutout(ctx, productId, { slot: 'flat', key: started.key });
  await checkCutoutQuality(ctx.tenantId, productId, 'flat', started.key, 'r');
  return (await tryOnScreen(ctx)).watches[0]!.quality.flat!.key;
}

test('the crop: inside the picture, at least 20 px wide, and something to cut', () => {
  assert.deepEqual(calibrationCrop(107, 213, 0, 95), { left: 0, top: 0, width: 95, height: 213 });
  assert.deepEqual(calibrationCrop(107, 213, 6, 101), { left: 6, top: 0, width: 95, height: 213 }, 'the full height, always');
  assert.equal(calibrationCrop(107, 213, 0, 107), null, 'nothing to cut');
  assert.equal(calibrationCrop(107, 213, -1, 95), null);
  assert.equal(calibrationCrop(107, 213, 0, 108), null, 'past the picture');
  assert.equal(calibrationCrop(107, 213, 50, 50 + CALIBRATE_MIN_PX - 1), null, 'too narrow to be a case');
  assert.equal(calibrationCrop(107, 213, 0.5, 95), null, 'whole pixels');
});

test('marked → "checking" → cropped in the worker to the case, the studio’s own pixels exactly → checked again; the old picture goes, it is audited', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, tenantId } = await store(harness, 'alpha');
    const key = await uploaded(ctx, watch, await crowned());
    const before = (await tryOnScreen(ctx)).watches[0]!.quality.flat!;
    assert.equal(before.sizeShown, 1, 'the alpha check reads the crown as case — it cannot know');

    const view = await calibrateCutoutEdges(ctx, watch, { slot: 'flat', key, left: 0, right: 95 });
    assert.equal(view.quality.flat, null, 'the screen shows "checking" until the cropped picture is checked');
    const queued = await harness.asAdmin(() => harness.db.select().from(jobs).where(and(eq(jobs.queue, 'tryon.quality'), eq(jobs.tenantId, tenantId), eq(jobs.state, 'queued'))));
    const job = queued.find((j: any) => j.payload.crop);
    assert.equal((job as any).priority, 10, 'the merchant is watching: near the front');
    assert.deepEqual((job as any).payload, { productId: watch, slot: 'flat', key, crop: { left: 0, right: 95 } });

    await handleQualityJob(job as any);
    const row = await configOf(harness, watch);
    assert.notEqual(row.flatKey, key, 'a new key for new bytes');
    const now = await bytesAt(tenantId, row.flatKey!);
    const meta = await sharp(now).metadata();
    assert.deepEqual([meta.width, meta.height], [95, 213]);
    assert.equal(Buffer.compare(await pixels(now), await pixels(FLAT)), 0, 'the studio’s own shot, pixel for pixel');
    assert.equal(row.flatBytes, now.length, 'storage counts what is kept');
    const after = (await tryOnScreen(ctx)).watches[0]!.quality.flat!;
    assert.equal(after.key, row.flatKey, 'checked again, against the new picture');
    assert.equal(after.sizeShown, 1);
    assert.equal(await forTenant(tenantId).head(key), null, 'the marked picture is deleted (not live)');
    const audit = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)));
    assert.ok(audit.some((a: any) => a.changes?.after?.calibrated?.right === 95), 'the marks are in the audit log');
  } finally { await harness.close(); }
});

test('a WebP stays a lossless WebP; marks for a picture since replaced, or too narrow, or from someone who may not change try-on, are refused', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, tenantId } = await store(harness, 'bravo');
    const key = await uploaded(ctx, watch, await crowned('webp'), 'image/webp');
    assert.match(key, /\.webp$/);
    await assert.rejects(() => calibrateCutoutEdges(ctx, watch, { slot: 'flat', key: `${key}x`, left: 0, right: 95 }), (e: any) => e.code === 'conflict', 'another picture');
    await assert.rejects(() => calibrateCutoutEdges(ctx, watch, { slot: 'flat', key, left: 40, right: 50 }), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => calibrateCutoutEdges(ctx, watch, { slot: 'flat', key, left: 0.5, right: 95 }), (e: any) => e.code === 'validation_failed');

    const analystId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: analystId, email: 'an@example.test', passwordHash: 'x', fullName: 'A' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId: analystId, role: 'analyst', status: 'active' } as any);
    });
    const analyst = await buildTenantContext({ actor: { userId: analystId, email: 'an@example.test', isStaff: false }, tenantId, requestId: 'r' });
    await assert.rejects(() => calibrateCutoutEdges(analyst, watch, { slot: 'flat', key, left: 0, right: 95 }), (e: any) => e.code === 'forbidden');

    assert.equal(await calibrateCutout(tenantId, watch, 'flat', key, { left: 0, right: 95 }, 'r'), 'replaced');
    const row = await configOf(harness, watch);
    assert.match(row.flatKey!, /\.webp$/);
    assert.equal(Buffer.compare(await pixels(await bytesAt(tenantId, row.flatKey!)), await pixels(FLAT)), 0);
    assert.equal(await calibrateCutout(tenantId, watch, 'flat', key, { left: 0, right: 95 }, 'r'), 'skipped', 'the old key is no longer the picture: nothing is touched');
  } finally { await harness.close(); }
});

test('marks that no longer fit crop nothing — the picture is checked again, so the screen never waits for ever', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, tenantId } = await store(harness, 'charlie');
    const key = await uploaded(ctx, watch, await crowned());
    await calibrateCutoutEdges(ctx, watch, { slot: 'flat', key, left: 0, right: 500 });
    assert.equal((await tryOnScreen(ctx)).watches[0]!.quality.flat, null);
    assert.equal(await calibrateCutout(tenantId, watch, 'flat', key, { left: 0, right: 500 }, 'r'), 'measured');
    const row = await configOf(harness, watch);
    assert.equal(row.flatKey, key, 'the same picture');
    assert.equal((await tryOnScreen(ctx)).watches[0]!.quality.flat?.key, key, 'its check is back');
  } finally { await harness.close(); }
});
