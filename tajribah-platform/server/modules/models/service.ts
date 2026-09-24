/**
 * P1.12 — uploading a 3D model by hand: a presigned PUT straight to storage, then a
 * confirmation that checks what actually arrived.
 *
 *  1. `startUpload` makes the next version of the model (a new model if there is none yet),
 *     in state `draft`, with its file row, and returns a URL the browser PUTs the bytes to.
 *     The bytes never pass through a Worker.
 *  2. `confirmUpload` reads the stored object's first bytes (`inspect.ts`). A file that is
 *     not what it claims is deleted and its version marked `failed` with the reason; a good
 *     one moves to `processing`, which is where the pipeline (P1.13) picks it up. Confirming
 *     twice is harmless.
 *
 * Versions are numbered under a lock on the model row, so two uploads to one model at once
 * get 1 and 2, not a unique-key error. The live version is `models_3d.current_version_id`
 * only (see db/schema/ar.ts) — an upload never changes it; publishing does.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { modelFiles, models3d, modelVersions, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { record } from '@/server/core/audit/audit';
import { errors } from '@/server/core/errors/problem';
import { forTenant } from '@/server/core/storage/storage';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { CONTENT_TYPES, formatOf, HEADER_BYTES, inspect, MAX_MODEL_BYTES } from './inspect';
import { TARGET_BYTES } from './optimize';
import { enqueueProcessing } from './process';

/** Long enough for a slow phone connection; a presigned URL is a bearer credential. */
export const UPLOAD_URL_SECONDS = 15 * 60;

export type StartUploadInput = {
  filename: string;
  sizeBytes: number;
  productId?: string | null;
  modelId?: string | null;
};

export type StartedUpload = {
  modelId: string;
  versionId: string;
  version: number;
  uploadUrl: string;
  /** Send exactly this as `Content-Type`: the signature covers it. */
  contentType: string;
  expiresAt: string;
};

export type ConfirmedUpload = { versionId: string; status: 'processing' | 'failed'; error: string | null };

export async function startUpload(ctx: TenantContext, input: StartUploadInput): Promise<StartedUpload> {
  ctx.require('models:write');
  const format = formatOf(input.filename ?? '');
  const problems: Record<string, string[]> = {};
  if (!format) problems.filename = ['only .glb and .usdz files can be uploaded'];
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) problems.sizeBytes = ['the file is empty'];
  else if (input.sizeBytes > MAX_MODEL_BYTES) problems.sizeBytes = [`larger than ${MAX_MODEL_BYTES / 1024 / 1024} MB`];
  if (Object.keys(problems).length) throw errors.validation(problems);

  const store = forTenant(ctx.tenantId);
  const started = await withTenant(ctx.tenantId, async (db) => {
    let model = input.modelId ? await db.findById(models3d, input.modelId) : null;
    if (input.modelId && !model) throw errors.notFound('model');
    if (!model && input.productId) {
      const product = await db.findById(products, input.productId);
      if (!product || product.deletedAt) throw errors.notFound('product');
      model = await db.findOne(models3d, eq(models3d.productId, product.id));
      if (!model) {
        model = await db.insert(models3d, { id: uuidv7(), tenantId: ctx.tenantId, productId: product.id, name: product.name, source: 'uploaded', createdBy: ctx.actor.userId });
        await record(ctx, { action: 'create', resourceType: 'model', resourceId: model.id, after: model }, db);
      }
    }
    if (!model) {
      model = await db.insert(models3d, { id: uuidv7(), tenantId: ctx.tenantId, name: input.filename.replace(/\.[^.]+$/, ''), source: 'uploaded', createdBy: ctx.actor.userId });
      await record(ctx, { action: 'create', resourceType: 'model', resourceId: model.id, after: model }, db);
    }

    await db.lockById(models3d, model.id); // numbering: one upload at a time per model
    const [latest] = await db.find(modelVersions, eq(modelVersions.modelId, model.id), { limit: 1, orderBy: desc(modelVersions.version) });
    const version = (latest?.version ?? 0) + 1;
    const versionRow = await db.insert(modelVersions, { id: uuidv7(), tenantId: ctx.tenantId, modelId: model.id, version, status: 'draft', createdBy: ctx.actor.userId });
    const storageKey = store.key({ kind: 'model', id: model.id, filename: input.filename, version });
    await db.insert(modelFiles, {
      id: uuidv7(), tenantId: ctx.tenantId, modelVersionId: versionRow.id, format: format!, variant: 'original',
      storageKey, fileSizeBytes: input.sizeBytes, originalFilename: input.filename,
    });
    await record(ctx, { action: 'create', resourceType: 'model_version', resourceId: versionRow.id, after: { modelId: model.id, version, filename: input.filename } }, db);
    return { modelId: model.id, versionId: versionRow.id, version, storageKey };
  });

  const contentType = CONTENT_TYPES[format!];
  const { url, expiresAt } = await store.presignUpload(started.storageKey, { contentType, expiresInSeconds: UPLOAD_URL_SECONDS });
  return { modelId: started.modelId, versionId: started.versionId, version: started.version, uploadUrl: url, contentType, expiresAt: expiresAt.toISOString() };
}

export async function confirmUpload(ctx: TenantContext, versionId: string): Promise<ConfirmedUpload> {
  ctx.require('models:write');
  const version = await ctx.db.findById(modelVersions, versionId);
  if (!version) throw errors.notFound('model version');
  const file = await ctx.db.findOne(modelFiles, and(eq(modelFiles.modelVersionId, versionId), eq(modelFiles.variant, 'original')));
  if (!file) throw errors.notFound('model file');
  if (version.status !== 'draft') {
    // Already confirmed (or failed): say what happened, change nothing.
    return { versionId, status: version.status === 'failed' ? 'failed' : 'processing', error: null };
  }

  const store = forTenant(ctx.tenantId);
  const stored = await store.head(file.storageKey);
  if (!stored) throw errors.conflict('the file has not arrived yet — upload it to the URL you were given, then confirm');

  let problem: string | null = null;
  if (stored.size > MAX_MODEL_BYTES) problem = `larger than ${MAX_MODEL_BYTES / 1024 / 1024} MB`;
  else problem = inspect(file.format as 'glb' | 'usdz', await firstBytes(store, file.storageKey), stored.size);

  if (problem) await store.delete(file.storageKey); // never keep bytes we refused

  const outcome = await withTenant(ctx.tenantId, async (db): Promise<ConfirmedUpload & { fresh: boolean }> => {
    const before = await db.lockById(modelVersions, versionId);
    if (before.status !== 'draft') return { versionId, status: before.status === 'failed' ? 'failed' as const : 'processing' as const, error: null, fresh: false };
    const status = problem ? 'failed' as const : 'processing' as const;
    const after = await db.updateById(modelVersions, versionId, { status });
    await db.updateById(modelFiles, file.id, { fileSizeBytes: stored.size, checksum: stored.checksum });
    const model = await db.requireById(models3d, version.modelId);
    // A model with no live version shows the state of its first upload.
    if (!model.currentVersionId) await db.updateById(models3d, model.id, { status: problem ? 'failed' : 'processing' });
    await record(ctx, { action: 'update', resourceType: 'model_version', resourceId: versionId, before, after: { ...after, ...(problem ? { error: problem } : {}) } }, db);
    return { versionId, status, error: problem, fresh: true };
  });
  // After the commit: a job for a version that rolled back would process nothing.
  if (outcome.fresh && outcome.status === 'processing') await enqueueProcessing(ctx.tenantId, versionId);
  return { versionId: outcome.versionId, status: outcome.status, error: outcome.error };
}

/** Every version of a model, newest first, with `isCurrent` computed from the model's pointer. */
export async function modelVersionsOf(ctx: TenantContext, modelId: string) {
  ctx.require('models:read');
  const model = await ctx.db.findById(models3d, modelId);
  if (!model) throw errors.notFound('model');
  const versions = await ctx.db.find(modelVersions, eq(modelVersions.modelId, modelId), { orderBy: desc(modelVersions.version), limit: 100 });
  const files = versions.length
    ? await ctx.db.find(modelFiles, inArray(modelFiles.modelVersionId, versions.map((v) => v.id)), { limit: 1000 })
    : [];
  const sizeOf = (versionId: string, variant: 'original' | 'optimized') =>
    files.find((f) => f.modelVersionId === versionId && f.variant === variant)?.fileSizeBytes ?? null;
  return versions.map((v) => {
    const optimizedBytes = sizeOf(v.id, 'optimized');
    return {
      id: v.id, version: v.version, status: v.status, isCurrent: v.id === model.currentVersionId,
      polyCount: v.polyCount, originalBytes: sizeOf(v.id, 'original'), optimizedBytes,
      /** The < 2 MB report (§5). Null until there is an optimised file to measure. */
      withinTarget: optimizedBytes === null ? null : optimizedBytes <= TARGET_BYTES,
      createdAt: v.createdAt.toISOString(),
    };
  });
}

async function firstBytes(store: ReturnType<typeof forTenant>, storageKey: string): Promise<Uint8Array> {
  const object = await store.get(storageKey);
  if (!object) return new Uint8Array();
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < HEADER_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(length, HEADER_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.byteLength - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.byteLength) break;
  }
  return out;
}
