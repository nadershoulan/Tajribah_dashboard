/**
 * P1.13 — the `ai.postprocess` job: turn a confirmed upload into files a phone can use.
 *
 * For a GLB: optimise (`optimize.ts`), store `v{n}/optimized.glb` as its own `model_files`
 * row (`variant: optimized`, `compression: meshopt`), record what the model is made of, and
 * mark the version `ready`. Publishing is still a separate step (P1.14): a ready version is
 * not a live one.
 *
 * Idempotent: only a version still `processing` is worked on, the optimised file has a fixed
 * key (a retry overwrites it with the same bytes), and the file row is written once.
 * A file that cannot be read fails the version for good; a storage error is thrown so the
 * queue retries it with backoff.
 */
import { and, eq } from 'drizzle-orm';
import type { Job } from '@/db/schema';
import { modelFiles, models3d, modelVersions } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { record } from '@/server/core/audit/audit';
import { enqueue } from '@/server/core/jobs/queue';
import { log } from '@/server/core/observability/log';
import { currentScope } from '@/server/core/observability/scope';
import { forTenant } from '@/server/core/storage/storage';
import { systemContext, type TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { CONTENT_TYPES } from './inspect';
import { optimizeGlb, TARGET_BYTES, UnreadableModelError, type ModelStats } from './optimize';
import { notifyIn } from '@/server/modules/notifications/service';

export const PROCESS_PERMISSIONS = ['models:read', 'models:write'] as const;
export type ProcessOutcome = 'ready' | 'failed' | 'skipped';

export async function enqueueProcessing(tenantId: string, versionId: string): Promise<void> {
  await enqueue({ queue: 'ai.postprocess', tenantId, payload: { versionId }, dedupeKey: `model:${versionId}:process` });
}

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

  let optimized;
  try {
    optimized = await optimizeGlb(bytes);
  } catch (error) {
    if (error instanceof UnreadableModelError) return finish(ctx, versionId, { failure: error.message });
    throw error;
  }
  const key = store.key({ kind: 'model', id: version.modelId, filename: 'optimized.glb', version: version.version });
  await store.put(key, toArrayBuffer(optimized.bytes), { contentType: CONTENT_TYPES.glb, immutable: true });
  return finish(ctx, versionId, { stats: optimized.stats, optimized: { key, size: optimized.bytes.byteLength, originalSize: bytes.byteLength } });
}

async function finish(
  ctx: TenantContext, versionId: string,
  result: { failure?: string; stats?: ModelStats; optimized?: { key: string; size: number; originalSize: number } },
): Promise<ProcessOutcome> {
  return withTenant(ctx.tenantId, async (db) => {
    const before = await db.lockById(modelVersions, versionId);
    if (before.status !== 'processing') return 'skipped' as const; // another run finished it
    const status = result.failure ? 'failed' as const : 'ready' as const;

    if (result.optimized) {
      const existing = await db.findOne(modelFiles, and(eq(modelFiles.modelVersionId, versionId), eq(modelFiles.variant, 'optimized')));
      if (!existing) {
        await db.insert(modelFiles, {
          id: uuidv7(), tenantId: ctx.tenantId, modelVersionId: versionId, format: 'glb', variant: 'optimized',
          storageKey: result.optimized.key, fileSizeBytes: result.optimized.size, compression: 'meshopt',
        });
      }
    }
    const after = await db.updateById(modelVersions, versionId, {
      status,
      ...(result.stats ? {
        polyCount: result.stats.polyCount, materialCount: result.stats.materialCount,
        textureCount: result.stats.textureCount, boundingBox: result.stats.boundingBox,
      } : {}),
    });
    const model = await db.requireById(models3d, before.modelId);
    if (!model.currentVersionId) await db.updateById(models3d, model.id, { status });

    const report = result.optimized
      ? { originalBytes: result.optimized.originalSize, optimizedBytes: result.optimized.size, withinTarget: result.optimized.size <= TARGET_BYTES }
      : {};
    await record(ctx, {
      action: 'update', resourceType: 'model_version', resourceId: versionId,
      before, after: { ...after, ...report, ...(result.failure ? { error: result.failure } : {}) },
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
