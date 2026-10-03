/**
 * P5.9 — the `tryon.quality` job: is a confirmed cut-out drawn at its real size in the studio?
 *
 * The studio draws a picture's full width as the case width (`lib/tryon-quality.ts`), so after
 * each confirmed upload this job reads the picture's alpha channel and:
 *  - **crops away empty edges** (nothing visible there, alpha < 3%): the cropped copy is stored
 *    under a new key and replaces the upload — a picture with a margin would otherwise show the
 *    watch smaller than it is.
 *  - P5.12: **stores a PNG as lossless WebP** when that is clearly smaller (about half, measured on
 *    the studio's own pictures) — the same pixels, fewer bytes on the shopper's phone. WebP is always
 *    written lossless and `exact` (even invisible pixels keep their colour), so nothing changes.
 *  - **measures the share of real size shown** once cropped (a soft shadow or glow at the sides
 *    still shrinks the watch) and keeps it against the picture's key, with the watch's score
 *    (`quality_score`, the worse picture, 0–100) once both pictures are checked.
 *
 * Runs in the Node worker (sharp is native — like the model optimiser, P1.13). Idempotent: a
 * picture replaced since the job was queued is skipped, and the swap happens under the product's
 * lock only if the key is still the one checked — otherwise the cropped copy is deleted. The
 * replaced upload's bytes are deleted after the change commits.
 */
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import type { Job } from '@/db/schema';
import { products, tryonConfigs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { alphaFacts, calibrationCrop, hasMargins, qualityScore, sizeShown, type SlotQuality, type TryOnQuality } from '@/lib/tryon-quality';
import { record } from '@/server/core/audit/audit';
import { currentScope } from '@/server/core/observability/scope';
import { forTenant } from '@/server/core/storage/storage';
import { systemContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { keepLive } from '@/server/modules/edge/publish';
import { retireCutout } from './retire';

import type { Slot } from './quality-queue';
export type { Slot } from './quality-queue';
export const QUALITY_PERMISSIONS = ['tryon:read', 'tryon:write'] as const;
export type QualityOutcome = 'measured' | 'replaced' | 'skipped';
/** Keep the WebP only when it saves at least this share — a near tie is not worth a new file. */
export const WEBP_KEEP_BELOW = 0.9;

const KEY_OF = { worn: 'wornKey', flat: 'flatKey' } as const;
const BYTES_OF = { worn: 'wornBytes', flat: 'flatBytes' } as const;

export { enqueueQuality } from './quality-queue';

export async function handleQualityJob(job: Job): Promise<void> {
  const p = job.payload as { productId?: string; slot?: Slot; key?: string; crop?: { left?: unknown; right?: unknown } } | null;
  if (!job.tenantId || !p?.productId || (p.slot !== 'worn' && p.slot !== 'flat') || !p.key) throw new Error(`try-on quality job ${job.id} is missing its tenant, product, slot or key`);
  const requestId = currentScope()?.requestId ?? `job-${job.id}`;
  if (p.crop) await calibrateCutout(job.tenantId, p.productId, p.slot, p.key, { left: Number(p.crop.left), right: Number(p.crop.right) }, requestId);
  else await checkCutoutQuality(job.tenantId, p.productId, p.slot, p.key, requestId);
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function checkCutoutQuality(tenantId: string, productId: string, slot: Slot, key: string, requestId: string): Promise<QualityOutcome> {
  const ctx = await systemContext({ tenantId, requestId, permissions: QUALITY_PERMISSIONS });
  const current = await ctx.db.findOne(tryonConfigs, eq(tryonConfigs.productId, productId));
  if (!current || current[KEY_OF[slot]] !== key) return 'skipped'; // replaced or removed since
  const store = forTenant(tenantId);
  const object = await store.get(key);
  if (!object) return 'skipped';
  const bytes = await readAll(object.body);
  const webp = key.endsWith('.webp');

  // Measure; crop when there is anything to crop; keep the smaller of PNG and lossless WebP.
  let found: Omit<SlotQuality, 'key'>;
  let cropped: { key: string; bytes: Uint8Array } | null = null;
  try {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const facts = alphaFacts(data, info.width, info.height);
    if (!facts.box) found = { sizeShown: 0, trimmed: false, issue: 'empty' };
    else {
      const trimmed = hasMargins(facts);
      const picture = () => (trimmed ? sharp(bytes).extract(facts.box!) : sharp(bytes));
      const asWebp = new Uint8Array(await picture().webp({ lossless: true, exact: true }).toBuffer());
      // The PNG to beat: the upload itself, or its cropped copy.
      const asPng = webp ? null : trimmed ? new Uint8Array(await picture().png({ compressionLevel: 9 }).toBuffer()) : bytes;
      const useWebp = webp || asWebp.length < asPng!.length * WEBP_KEEP_BELOW;
      const out = useWebp ? asWebp : asPng!;
      found = { sizeShown: sizeShown(facts), trimmed, ...(useWebp && !webp ? { converted: true } : {}) };
      if (trimmed || (useWebp && !webp)) {
        const next = store.key({ kind: 'photo', id: uuidv7(), filename: `${slot}.${useWebp ? 'webp' : 'png'}` });
        // A new key for new bytes, never rewritten: phones and the CDN may keep it for good.
        await store.put(next, out.slice().buffer as ArrayBuffer, { contentType: useWebp ? 'image/webp' : 'image/png', immutable: true });
        cropped = { key: next, bytes: out };
      }
    }
  } catch {
    found = { sizeShown: 0, trimmed: false, issue: 'unreadable' };
  }

  const { applied, replaced } = await withTenant(tenantId, async (db) => {
    await db.lockById(products, productId);
    const before = await db.findOne(tryonConfigs, eq(tryonConfigs.productId, productId));
    if (!before || before[KEY_OF[slot]] !== key) return { applied: false, replaced: null };
    const finalKey = cropped?.key ?? key;
    const slotQuality: SlotQuality = { key: finalKey, ...found };
    const quality: TryOnQuality = { ...(before.quality ?? {}), [slot]: slotQuality };
    const other = slot === 'worn' ? 'flat' : 'worn';
    const otherQuality = quality[other]?.key === before[KEY_OF[other]] ? quality[other] : null;
    const values: Partial<typeof tryonConfigs.$inferInsert> = {
      quality,
      qualityScore: qualityScore(slot === 'worn' ? slotQuality : otherQuality, slot === 'flat' ? slotQuality : otherQuality),
    };
    if (cropped) Object.assign(values, { [KEY_OF[slot]]: cropped.key, [BYTES_OF[slot]]: cropped.bytes.length });
    const after = await db.updateById(tryonConfigs, before.id, values as never);
    await record(ctx, {
      action: 'update', resourceType: 'tryon_config', resourceId: after.id,
      before: { [KEY_OF[slot]]: key } as never,
      after: { [KEY_OF[slot]]: finalKey, sizeShown: found.sizeShown, trimmed: found.trimmed, converted: found.converted ?? false, qualityScore: after.qualityScore } as never,
    }, db);
    return { applied: true, replaced: cropped ? key : null };
  });

  if (!applied) {
    if (cropped) await store.delete(cropped.key).catch(() => undefined);
    return 'skipped';
  }
  if (replaced) {
    await keepLive(tenantId, productId); // P1.15: the live config names the cropped picture before the old one goes
    await retireCutout(tenantId, productId, replaced); // T36: kept a while if shoppers may still hold it
  }
  return cropped ? 'replaced' : 'measured';
}

/**
 * T68 calibration — crop the picture `key` to the case's marked edges (full height; the pixels kept
 * are copied unchanged, the format kept: WebP lossless and exact, or PNG), swap it in under the
 * product's lock if `key` is still the picture, then check it again like any new picture. Marks that
 * no longer fit (the picture changed size) crop nothing: the picture is simply checked again, so the
 * screen never waits on a check that will not come.
 */
export async function calibrateCutout(tenantId: string, productId: string, slot: Slot, key: string, marks: { left: number; right: number }, requestId: string): Promise<QualityOutcome> {
  const ctx = await systemContext({ tenantId, requestId, permissions: QUALITY_PERMISSIONS });
  const current = await ctx.db.findOne(tryonConfigs, eq(tryonConfigs.productId, productId));
  if (!current || current[KEY_OF[slot]] !== key) return 'skipped';
  const store = forTenant(tenantId);
  const object = await store.get(key);
  if (!object) return 'skipped';
  const bytes = await readAll(object.body);
  const webp = key.endsWith('.webp');
  let out: Uint8Array | null = null;
  try {
    const meta = await sharp(bytes).metadata();
    const crop = calibrationCrop(meta.width ?? 0, meta.height ?? 0, marks.left, marks.right);
    if (crop) {
      const picture = sharp(bytes).extract(crop);
      out = new Uint8Array(await (webp ? picture.webp({ lossless: true, exact: true }) : picture.png({ compressionLevel: 9 })).toBuffer());
    }
  } catch {
    out = null;
  }
  if (!out) return checkCutoutQuality(tenantId, productId, slot, key, requestId);

  const next = store.key({ kind: 'photo', id: uuidv7(), filename: `${slot}.${webp ? 'webp' : 'png'}` });
  await store.put(next, out.slice().buffer as ArrayBuffer, { contentType: webp ? 'image/webp' : 'image/png', immutable: true });
  const applied = await withTenant(tenantId, async (db) => {
    await db.lockById(products, productId);
    const before = await db.findOne(tryonConfigs, eq(tryonConfigs.productId, productId));
    if (!before || before[KEY_OF[slot]] !== key) return false;
    const quality: TryOnQuality = { ...(before.quality ?? {}) };
    delete quality[slot]; // checked again just below
    const after = await db.updateById(tryonConfigs, before.id, { [KEY_OF[slot]]: next, [BYTES_OF[slot]]: out!.length, quality, qualityScore: null } as never);
    await record(ctx, {
      action: 'update', resourceType: 'tryon_config', resourceId: after.id,
      before: { [KEY_OF[slot]]: key } as never,
      after: { [KEY_OF[slot]]: next, calibrated: { left: marks.left, right: marks.right } } as never,
    }, db);
    return true;
  });
  if (!applied) {
    await store.delete(next).catch(() => undefined);
    return 'skipped';
  }
  await keepLive(tenantId, productId); // the live config names the cropped picture before the old one goes
  await retireCutout(tenantId, productId, key);
  await checkCutoutQuality(tenantId, productId, slot, next, requestId);
  return 'replaced';
}
