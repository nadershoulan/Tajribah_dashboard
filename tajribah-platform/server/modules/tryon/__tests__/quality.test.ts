/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P5.9 — the cut-out check, on the studio's own real cut-outs and variants made from them: the
 * studio draws a picture's full width as the case width, so empty edges are cropped away (PNG
 * and WebP), a soft glow at the sides is measured as a smaller watch, an empty picture is named,
 * and a picture replaced while its check waited is never touched. P5.12: a PNG is stored as
 * lossless WebP when that is clearly smaller — pixel for pixel the same.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { auditLogs, jobs, products, subscriptions, tryonConfigs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { TRUE_SIZE_MIN, alphaFacts, qualityScore, sizeShown } from '@/lib/tryon-quality';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, forTenant, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import { checkCutoutQuality } from '@/server/modules/tryon/quality';
import { confirmCutout, startCutoutUpload, tryOnScreen } from '@/server/modules/tryon/service';

setLogLevel('error');
const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'server/modules/tryon/__tests__/fixtures', name)));
const WORN = fixture('worn.png'); // 224 × 420, cropped tight
const FLAT = fixture('flat.png'); // 95 × 213, cropped tight

/** The real flat shot with `side` px of empty space on the left and right and `top` above. */
const padded = (side: number, top: number, format: 'png' | 'webp' = 'png') => {
  const img = sharp(FLAT).extend({ left: side, right: side, top, bottom: 0, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  return (format === 'webp' ? img.webp({ lossless: true, exact: true }) : img.png()).toBuffer().then((b) => new Uint8Array(b));
};
/** The real flat shot with a faint (alpha 60) glow band `side` px wide at both sides. */
const glowing = (side: number) => sharp(FLAT).extend({ left: side, right: side, background: { r: 255, g: 255, b: 255, alpha: 60 / 255 } }).png().toBuffer().then((b) => new Uint8Array(b));
const size = async (bytes: Uint8Array) => { const m = await sharp(bytes).metadata(); return [m.width, m.height, m.format]; };
const pixels = async (bytes: Uint8Array) => sharp(bytes).ensureAlpha().raw().toBuffer();
const samePixels = async (a: Uint8Array, b: Uint8Array) => Buffer.compare(await pixels(a), await pixels(b)) === 0;
/** The real flat shot quantised to 16 colours — a PNG lossless WebP cannot beat (98% of it). */
const paletted = () => sharp(FLAT).png({ palette: true, colours: 16, compressionLevel: 9 }).toBuffer().then((b) => new Uint8Array(b));

/** Storage that remembers how each file was written. */
class RecordingStorage extends MemoryStorage {
  puts: [string, unknown][] = [];
  override async put(key: string, body: ArrayBuffer | ReadableStream | string, options: { contentType?: string; immutable?: boolean } = {}) {
    this.puts.push([key, options]);
    return super.put(key, body, options);
  }
}

async function proStore(harness: TestDb, name: string) {
  const memory = new MemoryStorage();
  setStorage(memory);
  const seeded = await seedTenant(harness, name);
  const planId = await seededPlanId(harness, 'pro');
  const now = new Date();
  await harness.asAdmin(() => harness.db.insert(subscriptions).values({ id: uuidv7(), tenantId: seeded.tenantId, planId, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) } as any));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const watch = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values({ id: watch, tenantId: seeded.tenantId, name: 'Steel field watch', productType: 'watch' } as any));
  return { ...seeded, ctx, watch, memory };
}

async function upload(ctx: any, productId: string, slot: 'worn' | 'flat', bytes: Uint8Array, contentType = 'image/png') {
  const started = await startCutoutUpload(ctx, productId, { slot, filename: `${slot}.png`, contentType, sizeBytes: bytes.length });
  await forTenant(ctx.tenantId).put(started.key, bytes.slice().buffer as ArrayBuffer);
  await confirmCutout(ctx, productId, { slot, key: started.key });
  return started.key;
}
const configOf = (harness: TestDb, productId: string) => harness.asAdmin(async () => (await harness.db.select().from(tryonConfigs).where(eq(tryonConfigs.productId, productId)))[0]!);
const bytesAt = async (tenantId: string, key: string) => new Uint8Array(await new Response((await forTenant(tenantId).get(key))!.body).arrayBuffer());

test('the measure: the studio’s own pictures are true to size; margins and glow are read from alpha alone', async () => {
  for (const [bytes, expected] of [[FLAT, 1], [WORN, 0.996]] as const) {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const facts = alphaFacts(data, info.width, info.height);
    assert.deepEqual(facts.box, { left: 0, top: 0, width: info.width, height: info.height }, 'cropped tight already');
    assert.equal(sizeShown(facts), expected);
    assert.ok(sizeShown(facts) >= TRUE_SIZE_MIN);
  }
  const { data, info } = await sharp(await glowing(10)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const glow = alphaFacts(data, info.width, info.height);
  assert.deepEqual([glow.box?.width, glow.solidWidest, sizeShown(glow)], [115, 95, 0.826], 'the glow widens the picture, not the watch');
  assert.equal(qualityScore({ key: 'a', sizeShown: 0.996, trimmed: false }, { key: 'b', sizeShown: 1, trimmed: false }), 99, 'the worse picture decides');
  assert.equal(qualityScore({ key: 'a', sizeShown: 1, trimmed: false }, null), null, 'not until both are checked');
});

test('a confirmed picture is queued; the real pair measures true to size and is stored as lossless WebP — half the bytes, the same pixels', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, tenantId } = await proStore(harness, 'alpha');
    const recording = new RecordingStorage();
    setStorage(recording);
    const worn = await upload(ctx, watch, 'worn', WORN);
    const flat = await upload(ctx, watch, 'flat', FLAT);
    const queued =await harness.asAdmin(() => harness.db.select().from(jobs).where(and(eq(jobs.queue, 'tryon.quality'), eq(jobs.tenantId, tenantId))));
    assert.deepEqual(queued.map((j: any) => j.payload.key).sort(), [worn, flat].sort(), 'one check per confirmed picture');

    assert.deepEqual((await tryOnScreen(ctx)).watches[0]!.quality, { worn: null, flat: null, score: null }, 'checking');
    assert.equal(await checkCutoutQuality(tenantId, watch, 'worn', worn, 'r'), 'replaced');
    assert.equal(await checkCutoutQuality(tenantId, watch, 'flat', flat, 'r'), 'replaced');
    const row = await configOf(harness, watch);
    const q = (await tryOnScreen(ctx)).watches[0]!.quality;
    assert.deepEqual(q, { worn: { key: row.wornKey, sizeShown: 0.996, trimmed: false, converted: true }, flat: { key: row.flatKey, sizeShown: 1, trimmed: false, converted: true }, score: 99 });
    assert.match(row.wornKey!, /\/worn\.webp$/);
    assert.match(row.flatKey!, /\/flat\.webp$/);
    assert.deepEqual(recording.puts.filter(([key]) => key === row.wornKey || key === row.flatKey).map(([, options]) => options),
      [{ contentType: 'image/webp', immutable: true }, { contentType: 'image/webp', immutable: true }], 'new keys, never rewritten: kept by phones and the CDN');
    const [wornNow, flatNow] = [await bytesAt(tenantId, row.wornKey!), await bytesAt(tenantId, row.flatKey!)];
    assert.ok(wornNow.length < WORN.length * 0.6 && flatNow.length < FLAT.length * 0.65, `about half: ${wornNow.length} / ${WORN.length}, ${flatNow.length} / ${FLAT.length}`);
    assert.deepEqual([row.wornBytes, row.flatBytes], [wornNow.length, flatNow.length], 'storage counts what is kept');
    assert.ok(await samePixels(wornNow, WORN) && await samePixels(flatNow, FLAT), 'pixel for pixel the same pictures');
    assert.deepEqual([await forTenant(tenantId).head(worn), await forTenant(tenantId).head(flat)], [null, null], 'the PNG uploads are deleted');
  } finally { await harness.close(); }
});

test('empty edges are cropped away — losslessly, PNG or WebP — the upload’s bytes go, and it is audited', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, tenantId, memory } = await proStore(harness, 'alpha');
    const png = await upload(ctx, watch, 'flat', await padded(40, 25));
    assert.equal(await checkCutoutQuality(tenantId, watch, 'flat', png, 'r'), 'replaced');
    let row = await configOf(harness, watch);
    assert.notEqual(row.flatKey, png);
    assert.match(row.flatKey!, new RegExp(`^t/${tenantId}/photo/[0-9a-f-]{36}/flat\\.webp$`), 'a cut-out key of this store and slot');
    assert.equal(await forTenant(tenantId).head(png), null, 'the padded upload is deleted');
    const cropped = await bytesAt(tenantId, row.flatKey!);
    assert.deepEqual(await size(cropped), [95, 213, 'webp'], 'back to the watch itself');
    assert.equal(row.flatBytes, cropped.length, 'storage counts the cropped picture');
    assert.deepEqual(row.quality?.flat, { key: row.flatKey, sizeShown: 1, trimmed: true, converted: true });
    const { data } = await sharp(cropped).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data: original } = await sharp(FLAT).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.ok(Buffer.compare(data, original) === 0, 'every pixel of the watch is unchanged');
    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceId, row.id)));
    assert.ok(trail.some((a: any) => a.actorType === 'system' && a.changes?.after?.trimmed === true && a.changes?.after?.flatKey === row.flatKey), 'the crop is in the audit trail, by the system');

    const webp = await upload(ctx, watch, 'worn', await padded(30, 0, 'webp'), 'image/webp');
    assert.equal(await checkCutoutQuality(tenantId, watch, 'worn', webp, 'r'), 'replaced');
    row = await configOf(harness, watch);
    assert.match(row.wornKey!, /\/worn\.webp$/);
    const cutWebp = await bytesAt(tenantId, row.wornKey!);
    assert.deepEqual(await size(cutWebp), [95, 213, 'webp']);
    const { data: webpPixels } = await sharp(cutWebp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.ok(Buffer.compare(webpPixels, original) === 0, 'lossless: every pixel unchanged');
    const held = (await memory.list(`t/${tenantId}/photo/`, 100)).map((o) => o.key).sort();
    assert.deepEqual(held, [row.flatKey, row.wornKey].sort(), 'only the two cropped pictures are held');
    assert.equal(row.qualityScore, 100);
  } finally { await harness.close(); }
});

test('a soft glow at the sides is measured as a smaller watch; an empty picture is named', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, tenantId } = await proStore(harness, 'alpha');
    const glow = await upload(ctx, watch, 'flat', await glowing(10));
    assert.equal(await checkCutoutQuality(tenantId, watch, 'flat', glow, 'r'), 'replaced');
    const empty = await upload(ctx, watch, 'worn', await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer().then((b) => new Uint8Array(b)));
    assert.equal(await checkCutoutQuality(tenantId, watch, 'worn', empty, 'r'), 'measured');
    const q = (await tryOnScreen(ctx)).watches[0]!.quality;
    assert.deepEqual({ ...q.flat, key: undefined }, { key: undefined, sizeShown: 0.826, trimmed: false, converted: true });
    assert.deepEqual(q.worn, { key: empty, sizeShown: 0, trimmed: false, issue: 'empty' });
    assert.equal(q.score, 0);
  } finally { await harness.close(); }
});

test('a picture replaced while its check waited is never touched, and the check’s own copy is removed', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, tenantId, memory } = await proStore(harness, 'alpha');
    const first = await upload(ctx, watch, 'flat', await padded(40, 0));
    const second = await upload(ctx, watch, 'flat', FLAT);
    assert.equal(await checkCutoutQuality(tenantId, watch, 'flat', first, 'r'), 'skipped');
    const row = await configOf(harness, watch);
    assert.equal(row.flatKey, second);
    assert.equal(row.quality, null);
    assert.deepEqual((await memory.list(`t/${tenantId}/photo/`, 100)).map((o) => o.key), [second], 'nothing left behind');
    assert.equal((await tryOnScreen(ctx)).watches[0]!.quality.flat, null, 'the new picture shows as checking');

    // A result kept for an earlier picture is not shown for the one that replaced it.
    await checkCutoutQuality(tenantId, watch, 'flat', second, 'r');
    const third = await upload(ctx, watch, 'flat', FLAT);
    assert.equal((await tryOnScreen(ctx)).watches[0]!.quality.flat, null);
    assert.ok(third);
    // …nor does it count in the score: the worn picture checked now, the flat one still waiting.
    const worn = await upload(ctx, watch, 'worn', WORN);
    await checkCutoutQuality(tenantId, watch, 'worn', worn, 'r');
    assert.equal((await configOf(harness, watch)).qualityScore, null, 'no score while a picture waits for its check');
  } finally { await harness.close(); }
});

/** Storage that runs `after` once, right after a read has taken its bytes — a race, on cue. */
class RacingStorage extends MemoryStorage {
  after: ((key: string) => Promise<void>) | null = null;
  override async get(key: string) {
    const found = await super.get(key);
    const hook = this.after;
    if (hook) { this.after = null; await hook(key); }
    return found;
  }
}

test('a race: the picture is replaced after the check read it — the swap is refused and the check’s copy removed', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, tenantId } = await proStore(harness, 'alpha');
    const racing = new RacingStorage();
    setStorage(racing);
    const first = await upload(ctx, watch, 'flat', await padded(40, 0));
    let second = '';
    racing.after = async () => { second = await upload(ctx, watch, 'flat', FLAT); };
    assert.equal(await checkCutoutQuality(tenantId, watch, 'flat', first, 'r'), 'skipped');
    const row = await configOf(harness, watch);
    assert.deepEqual([row.flatKey, row.quality], [second, null], 'the newer picture stands, unjudged');
    assert.deepEqual((await racing.list(`t/${tenantId}/photo/`, 100)).map((o) => o.key), [second], 'the cropped copy of the old one is gone');
  } finally { await harness.close(); }
});


test('a PNG that lossless WebP cannot clearly beat is left exactly as uploaded', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch, tenantId } = await proStore(harness, 'alpha');
    const bytes = await paletted();
    const key = await upload(ctx, watch, 'flat', bytes);
    assert.equal(await checkCutoutQuality(tenantId, watch, 'flat', key, 'r'), 'measured');
    const row = await configOf(harness, watch);
    assert.equal(row.flatKey, key);
    assert.deepEqual(await bytesAt(tenantId, key), bytes, 'byte for byte');
    assert.deepEqual(row.quality?.flat, { key, sizeShown: 0.989, trimmed: false }, 'measured as ever (16 colours soften the edge a little)');
  } finally { await harness.close(); }
});
