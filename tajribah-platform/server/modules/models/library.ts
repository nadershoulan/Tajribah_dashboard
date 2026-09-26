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
import { desc, inArray } from 'drizzle-orm';
import { modelFiles, models3d, modelVersions, products } from '@/db/schema';
import type { ModelRow } from '@/lib/view-models';
import { record } from '@/server/core/audit/audit';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { fileFor } from './files';

export async function listModels(ctx: TenantContext): Promise<ModelRow[]> {
  ctx.require('models:read');
  const models = await ctx.db.find(models3d, undefined, { orderBy: desc(models3d.updatedAt), limit: 500 });
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
      productName: product ? (product.nameAr ?? product.name) : null,
      name: model.name,
      source: model.source,
      status: model.status,
      qaStatus: model.qaStatus,
      version: version?.version ?? 0,
      sizeBytes: served?.fileSizeBytes ?? 0,
      polyCount: version?.polyCount ?? null,
      formats: [...new Set(own.map((f) => f.format).filter((f): f is 'glb' | 'usdz' => f === 'glb' || f === 'usdz'))],
      thumbnailUrl: null,
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
  await withTenant(ctx.tenantId, async (db) => {
    const version = await db.findById(modelVersions, versionId);
    if (!version) throw errors.notFound('model version');
    const model = await db.lockById(models3d, version.modelId);
    if (model.currentVersionId === versionId) return;
    if (version.status !== 'ready') {
      throw errors.conflict(`version ${version.version} is ${version.status} — only a ready version can go live`);
    }
    const after = await db.updateById(models3d, model.id, { currentVersionId: versionId, status: 'ready' });
    await db.updateById(modelVersions, versionId, { publishedAt: new Date() });
    await record(ctx, {
      action: 'publish', resourceType: 'model', resourceId: model.id,
      before: { currentVersionId: model.currentVersionId }, after: { currentVersionId: after.currentVersionId, version: version.version },
    }, db);
  });
}
