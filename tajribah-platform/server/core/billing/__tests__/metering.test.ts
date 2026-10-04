/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P2.2 — every metered number has one source, idempotent by construction:
 *  - AR sessions: the rollup's days in this Riyadh month (a re-run rewrites a day, never adds);
 *  - storage: bytes held now — deleted bytes (refused, expired) never count; checked before upload;
 *  - bandwidth: a per-day total, set not added — replays and concurrent reports write one number;
 *  - the home screen shows the quota's own figures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { dailyTenantStats, modelFiles, planLimits, products, usageCounters } from '@/db/schema';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { BYTES_PER_GB, currentUsage, reportDailyBandwidth, storageBytesHeld } from '@/server/core/billing/entitlements';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import { confirmUpload, startUpload } from '@/server/modules/models/service';
import { expireStaleDrafts } from '@/server/modules/models/cleanup';
import { dashboardSummary } from '@/server/modules/dashboard/service';

setLogLevel('error');

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);

/** A minimal valid glTF 2.0 binary. */
function glb(): Uint8Array {
  const text = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
  const padded = Math.ceil(text.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + padded).fill(0x20, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.set(text, 20);
  return bytes;
}

async function upload(ctx: any, bytes: Uint8Array, filename = 'watch.glb') {
  const started = await startUpload(ctx, { filename, sizeBytes: bytes.byteLength });
  const key = started.uploadUrl.replace('memory://upload/', '');
  await storage().put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { contentType: started.contentType });
  return { ...started, confirmed: await confirmUpload(ctx, started.versionId) };
}

// 31 October 2026, 15:00 in Riyadh: the last day of a 31-day month.
const NOW = new Date('2026-10-31T12:00:00Z');

test('AR sessions: this Riyadh month of the rollup, own store only; a re-run day replaces, and the home screen agrees', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const other = await store(harness, 'bravo');
    await admin(harness, () => harness.db.insert(dailyTenantStats).values([
      { tenantId, day: '2026-09-30', arSessions: 1000 }, // last month
      { tenantId, day: '2026-10-01', arSessions: 5 },
      { tenantId, day: '2026-10-15', arSessions: 7 },
      { tenantId, day: '2026-10-31', arSessions: 11 },
      { tenantId: other.tenantId, day: '2026-10-10', arSessions: 100 },
    ] as any));
    assert.equal(await currentUsage(ctx, 'ar_sessions', NOW), 23);

    // The rollup runs again for the 15th with a fuller count: the day is replaced, not added.
    await admin(harness, () => harness.db.update(dailyTenantStats).set({ arSessions: 9 })
      .where(and(eq(dailyTenantStats.tenantId, tenantId), eq(dailyTenantStats.day, '2026-10-15'))));
    assert.equal(await currentUsage(ctx, 'ar_sessions', NOW), 25);

    const home = await dashboardSummary(ctx, NOW);
    assert.equal(home.usage.arSessions.used, 25, 'the 1st counts on the 31st (the old 30-day window dropped it)');
  } finally { await harness.close(); }
});

test('products: the home screen shows the number the quota counts — shown in 3D, archived included (T72)', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    await admin(harness, () => harness.db.insert(products).values([
      { tenantId, name: 'A', arEnabled: true }, { tenantId, name: 'B', status: 'archived', arEnabled: true }, { tenantId, name: 'C', deletedAt: new Date(), arEnabled: true },
      { tenantId, name: 'D' }, // in the catalogue, not shown in 3D: not counted
    ] as any));
    const home = await dashboardSummary(ctx, NOW);
    assert.equal(home.usage.products.used, await currentUsage(ctx, 'products'));
    assert.equal(home.usage.products.used, 2);
  } finally { await harness.close(); }
});

test('storage: bytes held now — refused and expired uploads free their bytes — and a full store refuses the next upload', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const other = await store(harness, 'bravo');
    const bytes = glb();

    const good = await upload(ctx, bytes);
    assert.equal(good.confirmed.status, 'processing');
    assert.equal(await storageBytesHeld(ctx), bytes.byteLength);

    const refused = await upload(ctx, new Uint8Array(48).fill(1), 'photo.glb'); // not a GLB: refused, bytes deleted
    assert.equal(refused.confirmed.status, 'failed');
    const [refusedFile] = await admin(harness, () => harness.db.select().from(modelFiles).where(eq(modelFiles.modelVersionId, refused.versionId)));
    assert.ok(refusedFile.bytesDeletedAt, 'the row says its bytes are gone');
    assert.equal(refusedFile.fileSizeBytes, 48, 'and keeps the size it had');
    assert.equal(await storageBytesHeld(ctx), bytes.byteLength, 'refused bytes are not held');

    await startUpload(ctx, { filename: 'draft.glb', sizeBytes: 5000 }); // never sent
    assert.equal(await storageBytesHeld(ctx), bytes.byteLength + 5000, 'a draft reserves its declared size until it expires');
    await expireStaleDrafts(new Date(Date.now() + 2 * 86_400_000));
    assert.equal(await storageBytesHeld(ctx), bytes.byteLength, 'an expired draft frees it');

    await upload(other.ctx, bytes);
    assert.equal(await storageBytesHeld(ctx), bytes.byteLength, "another store's files are not this store's storage");

    // Starter's storage limit lowered to 1 GB, and this store now holds 100 bytes short of it.
    const starter = await seededPlanId(harness, 'starter');
    await admin(harness, () => harness.db.update(planLimits).set({ value: 1 }).where(and(eq(planLimits.planId, starter), eq(planLimits.key, 'storage_gb'))));
    await admin(harness, () => harness.db.update(modelFiles).set({ fileSizeBytes: BYTES_PER_GB - 100 })
      .where(and(eq(modelFiles.tenantId, tenantId), eq(modelFiles.modelVersionId, good.versionId))));
    await assert.rejects(() => startUpload(ctx, { filename: 'big.glb', sizeBytes: 101 }),
      (e: any) => e.code === 'quota_exceeded' && /storage_gb \(1\)/.test(e.message));
    await startUpload(ctx, { filename: 'fits.glb', sizeBytes: 100 }); // exactly at the limit is allowed
    assert.equal(await currentUsage(ctx, 'storage_gb'), 1, 'reported in GB');
  } finally { await harness.close(); }
});

test('bandwidth: a day is set, not added — replays and concurrent reports leave one number', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const other = await store(harness, 'bravo');
    await reportDailyBandwidth(ctx, '2026-10-05', 2048);
    await reportDailyBandwidth(ctx, '2026-10-05', 2048); // the same report again
    assert.equal(await currentUsage(ctx, 'bandwidth_gb', NOW), 2);

    await Promise.all(Array.from({ length: 10 }, () => reportDailyBandwidth(ctx, '2026-10-06', 1024)));
    assert.equal(await currentUsage(ctx, 'bandwidth_gb', NOW), 3, 'ten concurrent reports of a day: one row');
    const rows = await admin(harness, () => harness.db.select().from(usageCounters).where(eq(usageCounters.tenantId, ctx.tenantId)));
    assert.equal(rows.length, 2);

    await reportDailyBandwidth(ctx, '2026-10-05', 3072); // a fuller report for the 5th replaces the first
    await reportDailyBandwidth(ctx, '2026-09-30', 99_999); // last month
    await reportDailyBandwidth(other.ctx, '2026-10-05', 99_999);
    assert.equal(await currentUsage(ctx, 'bandwidth_gb', NOW), 4);

    await assert.rejects(() => reportDailyBandwidth(ctx, '5 Oct', 1), /not a day/);
    await assert.rejects(() => reportDailyBandwidth(ctx, '2026-10-05', -1), /whole number/);
  } finally { await harness.close(); }
});

test('TenantDb.upsert: the conflict target must include the tenant, and a foreign tenant id is refused', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const other = await store(harness, 'bravo');
    const row = { metric: 'bandwidth_gb', periodStart: new Date(), value: 1 } as any;
    await assert.rejects(() => ctx.db.upsert(usageCounters, row, [usageCounters.periodStart, usageCounters.metric], { value: 1 } as any), /conflict target/);
    await assert.rejects(() => ctx.db.upsert(usageCounters, { ...row, tenantId: other.tenantId }, [usageCounters.tenantId, usageCounters.periodStart, usageCounters.metric], { value: 1 } as any), /Refusing/);
    await assert.rejects(() => ctx.db.upsert(usageCounters, row, [usageCounters.tenantId, usageCounters.periodStart, usageCounters.metric], { tenantId: other.tenantId } as any), /rows do not move/);
  } finally { await harness.close(); }
});
