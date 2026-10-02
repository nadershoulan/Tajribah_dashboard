/**
 * P1.14 — the model library: what each model is, which version is live, and publishing.
 *
 * `models_3d.current_version_id` is the only marker of the live version (db/schema/ar.ts).
 * Publishing moves that pointer, and nothing else does: an upload or a finished optimisation
 * never makes itself live. Rolling back is publishing an older version that is still ready.
 *
 * A row's size, polygons and formats describe the version a shopper would get — the live one,
 * or before anything is live, the newest version — so the list never shows the numbers of a
 * version nobody sees.
 */
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { modelFiles, models3d, modelVersions, products } from '@/db/schema';
import { forTenant } from '@/server/core/storage/storage';
import type { ModelRow } from '@/lib/view-models';
import { record } from '@/server/core/audit/audit';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { keepLive } from '@/server/modules/edge/publish';
import { retireFile } from '@/server/modules/tryon/retire';
import { fileFor } from './files';
import { emitEvent } from '@/server/modules/outgoing-webhooks/emit';
import { modelV1 } from '@/server/modules/public-api/v1';

export async function listModels(ctx: TenantContext): Promise<ModelRow[]> {
  ctx.require('models:read');
  const models = await ctx.db.find(models3d, ne(models3d.status, 'archived'), { orderBy: desc(models3d.updatedAt), limit: 500 }); // T46: deleted models are archived
  if (!models.length) return [];
  const ids = models.map((m) => m.id);
  const versions = await ctx.db.find(modelVersions, inArray(modelVersions.modelId, ids), { orderBy: desc(modelVersions.version), limit: 5000 });
  const productIds = [...new Set(models.map((m) => m.productId).filter((id): id is string => !!id))];
  const productRows = productIds.length ? await ctx.db.find(products, inArray(products.id, productIds), { limit: productIds.length }) : [];
  const shown = new Map(models.map((m) => [m.id, versions.find((v) => v.id === m.currentVersionId) ?? versions.find((v) => v.modelId === m.id) ?? null]));
  const shownIds = [...shown.values()].filter((v) => !!v).map((v) => v!.id);
  const files = shownIds.length ? await ctx.db.find(modelFiles, inArray(modelFiles.modelVersionId, shownIds), { limit: 5000 }) : [];

  return models.map((model) => {
    const version = shown.get(model.id) ?? null;
    const own = files.filter((f) => f.modelVersionId === version?.id);
    const served = fileFor(own, 'web') ?? fileFor(own, 'original');
    const product = productRows.find((p) => p.id === model.productId);
    return {
      id: model.id,
      productId: model.productId,
      productName: product?.name ?? null,
      productNameAr: product?.nameAr ?? null,
      name: model.name,
      source: model.source,
      status: model.status,
      qaStatus: model.qaStatus,
      qaNotes: model.qaStatus === 'rejected' ? model.qaNotes : null, // a reviewer's note; post-processing's is for staff
      version: version?.version ?? 0,
      sizeBytes: served?.fileSizeBytes ?? 0,
      polyCount: version?.polyCount ?? null,
      formats: [...new Set(own.map((f) => f.format).filter((f): f is 'glb' | 'usdz' => f === 'glb' || f === 'usdz'))],
      // P3.8: the picture's address on the file host (the public API's field); the dashboard shows it through API-129.
      thumbnailUrl: model.pictureKey ? forTenant(ctx.tenantId).publicUrl(model.pictureKey) : null,
      updatedAt: model.updatedAt.toISOString(),
    };
  });
}

/**
 * Make `versionId` the live version of its model. Only a `ready` version can go live — a
 * version still processing has no optimised file, and a failed one has nothing to show.
 * Publishing the version that is already live is a no-op.
 */
export async function publishVersion(ctx: TenantContext, versionId: string): Promise<void> {
  ctx.require('models:publish');
  const published = await withTenant(ctx.tenantId, async (db) => {
    const version = await db.findById(modelVersions, versionId);
    if (!version) throw errors.notFound('model version');
    const model = await db.lockById(models3d, version.modelId);
    if (model.currentVersionId === versionId) return null;
    if (version.status !== 'ready') {
      throw errors.conflict(`version ${version.version} is ${version.status} — only a ready version can go live`);
    }
    // P3.6 (T25): a generated model goes live only after a person at Tajribah has approved it.
    if (model.source === 'ai_generated' && model.qaStatus !== 'approved') {
      throw errors.conflict(model.qaStatus === 'rejected'
        ? 'this generated model was not approved in review — see the reviewer’s note'
        : 'this generated model is waiting for review by Tajribah before it can go live');
    }
    const after = await db.updateById(models3d, model.id, { currentVersionId: versionId, status: 'ready' });
    await db.updateById(modelVersions, versionId, { publishedAt: new Date() });
    await record(ctx, {
      action: 'publish', resourceType: 'model', resourceId: model.id,
      before: { currentVersionId: model.currentVersionId }, after: { currentVersionId: after.currentVersionId, version: version.version },
    }, db);
    return { modelId: model.id, productId: model.productId };
  });
  if (!published) return;
  if (published.productId) await keepLive(ctx.tenantId, published.productId); // P1.15: a live button shows the new version
  await emitEvent(ctx, 'model.published', async () => { // P8: built only if an endpoint wants it
    const row = (await listModels(ctx)).find((m) => m.id === published.modelId);
    if (!row) throw new Error('the published model is not in the library');
    return modelV1(row);
  });
}

/**
 * T46 — delete one version that is not live: its files' bytes are deleted and the storage they held
 * is freed (`bytes_deleted_at`); the version stays as an `archived` row, so numbering and the audit
 * trail keep their history. The live version cannot go on its own — publish another, or delete the
 * whole model.
 */
export async function deleteVersion(ctx: TenantContext, versionId: string): Promise<void> {
  ctx.require('models:write');
  const keys = await withTenant(ctx.tenantId, async (db) => {
    const version = await db.findById(modelVersions, versionId);
    if (!version || version.status === 'archived') throw errors.notFound('model version');
    const model = await db.lockById(models3d, version.modelId);
    if (model.currentVersionId === versionId) throw errors.conflict('this is the live version — publish another version first, or delete the whole model');
    if (version.status === 'processing') throw errors.conflict('this version is still being prepared — delete it once it is ready or has failed');
    return archiveVersions(ctx, db, [version.id], { action: 'delete', resourceType: 'model_version', resourceId: version.id, before: { version: version.version, status: version.status } });
  });
  for (const key of keys) await retireFile(ctx.tenantId, null, key); // not live: nothing names it
}

/**
 * T46 — delete a whole model: every version archived and its bytes deleted; the product's published
 * config is rebuilt without it (the watch's try-on stays, or the button is withdrawn). A file a live
 * config named is deleted after the grace period (T36), for shoppers still holding that config.
 */
export async function deleteModel(ctx: TenantContext, modelId: string): Promise<void> {
  ctx.require('models:write');
  ctx.require('models:publish'); // it changes what shoppers see
  const { keys, productId } = await withTenant(ctx.tenantId, async (db) => {
    const model = await db.lockById(models3d, modelId);
    if (model.status === 'archived') throw errors.notFound('model');
    const versions = await db.find(modelVersions, and(eq(modelVersions.modelId, modelId), ne(modelVersions.status, 'archived')), { limit: 1000 });
    await db.updateById(models3d, modelId, { status: 'archived', currentVersionId: null, pictureKey: null, pictureBytes: null, updatedAt: new Date() });
    const keys = await archiveVersions(ctx, db, versions.map((v) => v.id), {
      action: 'delete', resourceType: 'model', resourceId: modelId, before: { name: model.name, currentVersionId: model.currentVersionId, versions: versions.length },
    });
    return { keys: model.pictureKey ? [...keys, model.pictureKey] : keys, productId: model.productId }; // P3.8: its picture goes too
  });
  if (productId) await keepLive(ctx.tenantId, productId); // rebuilt before any file goes
  for (const key of keys) await retireFile(ctx.tenantId, productId, key);
}

/** Archive versions and mark their files' bytes deleted, in the caller's transaction; returns the keys to delete. */
async function archiveVersions(ctx: TenantContext, db: Parameters<Parameters<typeof withTenant>[1]>[0], versionIds: string[], audit: Parameters<typeof record>[1]): Promise<string[]> {
  const now = new Date();
  const files = versionIds.length ? await db.find(modelFiles, and(inArray(modelFiles.modelVersionId, versionIds), isNull(modelFiles.bytesDeletedAt)), { limit: 5000 }) : [];
  for (const id of versionIds) await db.updateById(modelVersions, id, { status: 'archived', updatedAt: now });
  for (const file of files) await db.updateById(modelFiles, file.id, { bytesDeletedAt: now });
  await record(ctx, { ...audit, after: { archived: versionIds.length, bytesFreed: files.reduce((sum, f) => sum + f.fileSizeBytes, 0) } }, db);
  return files.map((f) => f.storageKey);
}
