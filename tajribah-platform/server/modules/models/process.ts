/**
 * P1.13 — the `ai.postprocess` job: turn a confirmed upload into files a phone can use.
 *
 * For a GLB: optimise (`optimize.ts`) into the files `files.ts` names — `v{n}/optimized.glb`
 * for the web and, when the model can be made plain, `v{n}/native.glb` for Scene Viewer —
 * each its own `model_files` row; record what the model is made of, and mark the version
 * `ready`. Publishing is still a separate step (P1.14): a ready version is not a live one.
 * No native file is not a failure: Android then uses the in-page viewer.
 *
 * Idempotent: only a version still `processing` is worked on, each made file has a fixed key
 * (a retry overwrites it with the same bytes), and each file row is written once.
 * A file that cannot be read fails the version for good; a storage error is thrown so the
 * queue retries it with backoff.
 *
 * P3.5: a generated model (`source: ai_generated`) is fitted to its product's measurements and
 * stood on the floor; one whose shape disagrees with them is noted for QA review (`qa_notes`),
 * never stretched. An uploaded model keeps its own size. Every GLB gets its textures compressed
 * and, when too dense, its triangles reduced (`postprocess.ts`).
 */
import { and, eq } from 'drizzle-orm';
import type { Job } from '@/db/schema';
import { modelFiles, models3d, modelVersions, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { record } from '@/server/core/audit/audit';
import { log } from '@/server/core/observability/log';
import { currentScope } from '@/server/core/observability/scope';
import { forTenant } from '@/server/core/storage/storage';
import { systemContext, type TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { CONTENT_TYPES } from './inspect';
import { fileFor, MADE_FILES } from './files';
import { optimizeGlb, TARGET_BYTES, UnreadableModelError, type ModelStats, type Optimized } from './optimize';
import type { ProductSize } from './postprocess';
import { notifyIn } from '@/server/modules/notifications/service';

export const PROCESS_PERMISSIONS = ['models:read', 'models:write'] as const;
export type ProcessOutcome = 'ready' | 'failed' | 'skipped';

export { enqueueProcessing } from './process-queue';

export async function handleProcessJob(job: Job): Promise<void> {
  const versionId = (job.payload as { versionId?: string } | null)?.versionId;
  if (!job.tenantId || !versionId) throw new Error(`model job ${job.id} has no tenant or version`);
  await processVersion(job.tenantId, versionId, currentScope()?.requestId ?? `job-${job.id}`);
}

export async function processVersion(tenantId: string, versionId: string, requestId: string): Promise<ProcessOutcome> {
  const ctx = await systemContext({ tenantId, requestId, permissions: PROCESS_PERMISSIONS });
  const version = await ctx.db.findById(modelVersions, versionId);
  if (!version || version.status !== 'processing') return 'skipped';
  const original = await ctx.db.findOne(modelFiles, and(eq(modelFiles.modelVersionId, versionId), eq(modelFiles.variant, 'original')));
  if (!original) return finish(ctx, versionId, { failure: 'the uploaded file record is missing' });

  // A USDZ is already what iOS opens; there is nothing to optimise it into here (P1.13b).
  if (original.format !== 'glb') return finish(ctx, versionId, {});

  const store = forTenant(tenantId);
  const object = await store.get(original.storageKey); // storage errors throw → the queue retries
  if (!object) return finish(ctx, versionId, { failure: 'the uploaded file is no longer in storage' });
  const bytes = await readAll(object.body);

  // A generated model has no size of its own: it takes the product's (P3.5).
  const model = await ctx.db.requireById(models3d, version.modelId);
  let fit: ProductSize | null | undefined;
  if (model.source === 'ai_generated') {
    const product = model.productId ? await ctx.db.findById(products, model.productId) : null;
    fit = (product?.dimensions as ProductSize | null | undefined) ?? null;
  }

  let optimized;
  try {
    optimized = await optimizeGlb(bytes, fit === undefined ? {} : { fit });
  } catch (error) {
    if (error instanceof UnreadableModelError) return finish(ctx, versionId, { failure: error.message });
    throw error;
  }
  const put = async (role: 'web' | 'native', data: Uint8Array): Promise<MadeFile> => {
    const key = store.key({ kind: 'model', id: version.modelId, filename: MADE_FILES[role].filename, version: version.version });
    await store.put(key, toArrayBuffer(data), { contentType: CONTENT_TYPES[MADE_FILES[role].format], immutable: true });
    return { role, key, size: data.byteLength };
  };
  const made = [await put('web', optimized.bytes)];
  if ('bytes' in optimized.native) made.push(await put('native', optimized.native.bytes));
  return finish(ctx, versionId, {
    stats: optimized.stats, made, originalSize: bytes.byteLength, post: optimized.post,
    notes: 'skipped' in optimized.native ? { native: `none: ${optimized.native.skipped}` } : {},
  });
}

/** What QA needs to know about a generated model's size; null when there is nothing to say. */
export function qaNoteFor(post: Optimized['post']): string | null {
  const fit = post.fit;
  if (!fit) return null;
  if (!fit.applied) {
    return fit.reason === 'no_dimensions'
      ? 'not sized: the product has no measurements, so this model is not true to size'
      : 'not sized: the model has no geometry to measure';
  }
  const [w, h, d] = fit.sizeMm;
  return fit.proportions === 'differ'
    ? `check the shape: sized to ${w} × ${h} × ${d} mm, which does not agree with the product's measurements`
    : null;
}

type MadeFile = { role: 'web' | 'native' | 'quickLook'; key: string; size: number };

async function finish(
  ctx: TenantContext, versionId: string,
  result: { failure?: string; stats?: ModelStats; made?: MadeFile[]; originalSize?: number; notes?: Record<string, string>; post?: Optimized['post'] },
): Promise<ProcessOutcome> {
  return withTenant(ctx.tenantId, async (db) => {
    const before = await db.lockById(modelVersions, versionId);
    if (before.status !== 'processing') return 'skipped' as const; // another run finished it
    const status = result.failure ? 'failed' as const : 'ready' as const;

    const existing = await db.find(modelFiles, eq(modelFiles.modelVersionId, versionId), { limit: 10 });
    for (const file of result.made ?? []) {
      if (fileFor(existing, file.role)) continue;
      const { format, compression } = MADE_FILES[file.role];
      await db.insert(modelFiles, {
        id: uuidv7(), tenantId: ctx.tenantId, modelVersionId: versionId, format, variant: 'optimized',
        storageKey: file.key, fileSizeBytes: file.size, compression,
      });
    }
    const after = await db.updateById(modelVersions, versionId, {
      status,
      error: result.failure ?? null,
      ...(result.stats ? {
        polyCount: result.stats.polyCount, materialCount: result.stats.materialCount,
        textureCount: result.stats.textureCount, boundingBox: result.stats.boundingBox,
      } : {}),
    });
    const model = await db.requireById(models3d, before.modelId);
    if (!model.currentVersionId) await db.updateById(models3d, model.id, { status });
    // P3.6 (T25): every new version of a generated model waits for a person again, with
    // post-processing's note for them (or none, clearing the last review's).
    if (!result.failure && model.source === 'ai_generated') {
      await db.updateById(models3d, model.id, { qaStatus: 'pending', qaReviewedBy: null, qaNotes: result.post ? qaNoteFor(result.post) : null });
    }

    const sizeOf = (role: MadeFile['role']) => result.made?.find((f) => f.role === role)?.size;
    const web = sizeOf('web');
    const report = web === undefined ? {} : {
      originalBytes: result.originalSize, optimizedBytes: web, withinTarget: web <= TARGET_BYTES,
      ...(sizeOf('native') === undefined ? {} : { nativeBytes: sizeOf('native') }),
      ...(result.post ? { post: result.post } : {}),
      ...result.notes,
    };
    await record(ctx, {
      action: 'update', resourceType: 'model_version', resourceId: versionId,
      before, after: { ...after, ...report },
    }, db);
    await notifyIn(db, result.failure
      ? { type: 'model.failed', permission: 'models:read', level: 'error', href: '/dashboard/models',
          title: { ar: `تعذّر تجهيز «${model.name}»`, en: `“${model.name}” could not be prepared` }, body: { ar: result.failure, en: result.failure } }
      : { type: 'model.ready', permission: 'models:read', level: 'success', href: '/dashboard/models',
          title: { ar: `«${model.name}» جاهز للنشر`, en: `“${model.name}” is ready to publish` }, body: null });
    log.info('model processed', { versionId, status, ...report, ...(result.failure ? { error: result.failure } : {}) });
    return status;
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
