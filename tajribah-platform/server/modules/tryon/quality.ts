/**
 * P5.9 — the `tryon.quality` job: is a confirmed cut-out drawn at its real size in the studio?
 *
 * The studio draws a picture's full width as the case width (`lib/tryon-quality.ts`), so after
 * each confirmed upload this job reads the picture's alpha channel and:
 *  - **crops away empty edges** (nothing visible there, alpha < 3%): the cropped copy is stored
 *    under a new key and replaces the upload — a picture with a margin would otherwise show the
 *    watch smaller than it is. PNG stays PNG; WebP is written lossless (`exact`: even invisible pixels keep their colour).
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
import { alphaFacts, hasMargins, qualityScore, sizeShown, type SlotQuality, type TryOnQuality } from '@/lib/tryon-quality';
import { record } from '@/server/core/audit/audit';
import { enqueue } from '@/server/core/jobs/queue';
import { currentScope } from '@/server/core/observability/scope';
import { forTenant } from '@/server/core/storage/storage';
import { systemContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';

export type Slot = 'worn' | 'flat';
export const QUALITY_PERMISSIONS = ['tryon:read', 'tryon:write'] as const;
export type QualityOutcome = 'measured' | 'trimmed' | 'skipped';

const KEY_OF = { worn: 'wornKey', flat: 'flatKey' } as const;
const BYTES_OF = { worn: 'wornBytes', flat: 'flatBytes' } as const;

export async function enqueueQuality(tenantId: string, productId: string, slot: Slot, key: string): Promise<void> {
  await enqueue({ queue: 'tryon.quality', tenantId, payload: { productId, slot, key }, dedupeKey: `tryon:${key}:quality` });
}

export async function handleQualityJob(job: Job): Promise<void> {
  const p = job.payload as { productId?: string; slot?: Slot; key?: string } | null;
  if (!job.tenantId || !p?.productId || (p.slot !== 'worn' && p.slot !== 'flat') || !p.key) throw new Error(`try-on quality job ${job.id} is missing its tenant, product, slot or key`);
  await checkCutoutQuality(job.tenantId, p.productId, p.slot, p.key, currentScope()?.requestId ?? `job-${job.id}`);
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

  // Measure; crop when there is anything to crop.
  let found: Omit<SlotQuality, 'key'>;
  let cropped: { key: string; bytes: Uint8Array } | null = null;
  try {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const facts = alphaFacts(data, info.width, info.height);
    if (!facts.box) found = { sizeShown: 0, trimmed: false, issue: 'empty' };
    else {
      found = { sizeShown: sizeShown(facts), trimmed: false };
      if (hasMargins(facts)) {
        const cut = sharp(bytes).extract(facts.box);
        const out = new Uint8Array(await (webp ? cut.webp({ lossless: true, exact: true }) : cut.png({ compressionLevel: 9 })).toBuffer());
        const next = store.key({ kind: 'photo', id: uuidv7(), filename: `${slot}.${webp ? 'webp' : 'png'}` });
        await store.put(next, out.slice().buffer as ArrayBuffer, { contentType: webp ? 'image/webp' : 'image/png' });
        cropped = { key: next, bytes: out };
        found = { ...found, trimmed: true };
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
      after: { [KEY_OF[slot]]: finalKey, sizeShown: found.sizeShown, trimmed: found.trimmed, qualityScore: after.qualityScore } as never,
    }, db);
    return { applied: true, replaced: cropped ? key : null };
  });

  if (!applied) {
    if (cropped) await store.delete(cropped.key).catch(() => undefined);
    return 'skipped';
  }
  if (replaced) await store.delete(replaced).catch(() => undefined); // an orphan costs us, never the store
  return cropped ? 'trimmed' : 'measured';
}
