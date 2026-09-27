/**
 * P3.6 / A10 — the model QA review queue: a person looks at every generated model before a
 * shopper can see it (T25; the plan's P3 gate reads "generated, QA-approved").
 *
 *  - **What is in it**: models made by generation (`source: ai_generated`) whose newest version
 *    is ready. A merchant's own upload is their own file and is not held for review.
 *  - **Each new version starts over**: processing sets the model back to `pending` (P3.5 adds a
 *    note when the shape disagrees with the measurements or the product has none).
 *  - **Deciding**: approve, or reject with a note the merchant will read. Recorded twice, like
 *    every staff action on a store: in the staff trail and in the store's own activity. The
 *    merchant is told in the dashboard. Only a model whose newest version is ready can be decided —
 *    a reviewer must have something to look at.
 *  - **The gate** is in `publishVersion`: a generated model goes live only once approved.
 *  - **Looking at it**: the web file streams from here, same-origin, to staff only — the store's
 *    files are private until published, and the CDN is not the place to check a draft.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { modelFiles, models3d, modelVersions, products, tenants } from '@/db/schema';
import { errors } from '@/server/core/errors/problem';
import { record } from '@/server/core/audit/audit';
import { forTenant } from '@/server/core/storage/storage';
import { withTenant } from '@/server/core/tenancy/rls';
import { fileFor } from '@/server/modules/models/files';
import { notifyIn } from '@/server/modules/notifications/service';
import { staffLog, type StaffContext } from './access';
import { staffActingContext } from './stores';

export type QaStatus = 'pending' | 'approved' | 'rejected';

export type QaRow = {
  modelId: string;
  name: string;
  store: { id: string; name: string; nameAr: string | null };
  product: { id: string; name: string; nameAr: string | null; sizeMm: { widthMm?: number; heightMm?: number; depthMm?: number } | null } | null;
  qaStatus: QaStatus;
  qaNotes: string | null;
  /** The version to look at: the newest ready one. */
  version: { id: string; number: number; polyCount: number | null; sizeMm: [number, number, number] | null; webBytes: number | null; readyAt: string };
};

const mm = (box: { min: number[]; max: number[] } | null): [number, number, number] | null =>
  box ? [0, 1, 2].map((i) => Math.round((box.max[i]! - box.min[i]!) * 1000 * 10) / 10) as [number, number, number] : null;

/** A10 — the queue, oldest waiting first; `counts` for the tabs. */
export async function qaQueue(status: QaStatus = 'pending', limit = 50): Promise<{ rows: QaRow[]; counts: Record<QaStatus, number> }> {
  const db = unsafeAdminDb(); // staff read across every store (A1)
  const byStatus = await db.select({ status: models3d.qaStatus, n: sql<number>`count(*)::int` }).from(models3d)
    .where(and(eq(models3d.source, 'ai_generated'), sql`exists (select 1 from ${modelVersions} v where v.model_id = ${models3d.id} and v.status = 'ready')`))
    .groupBy(models3d.qaStatus);
  const counts: Record<QaStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const row of byStatus) counts[row.status as QaStatus] = Number(row.n);

  const found = await db.select({ model: models3d, tenant: tenants, product: products }).from(models3d)
    .innerJoin(tenants, eq(tenants.id, models3d.tenantId))
    .leftJoin(products, eq(products.id, models3d.productId))
    .where(and(eq(models3d.source, 'ai_generated'), eq(models3d.qaStatus, status)))
    .orderBy(status === 'pending' ? models3d.updatedAt : desc(models3d.updatedAt))
    .limit(Math.min(limit, 100));

  const rows: QaRow[] = [];
  for (const { model, tenant, product } of found) {
    const [version] = await db.select().from(modelVersions)
      .where(and(eq(modelVersions.modelId, model.id), eq(modelVersions.status, 'ready')))
      .orderBy(desc(modelVersions.version)).limit(1);
    if (!version) continue; // nothing to look at yet
    const files = await db.select().from(modelFiles).where(eq(modelFiles.modelVersionId, version.id));
    rows.push({
      modelId: model.id, name: model.name,
      store: { id: tenant.id, name: tenant.name, nameAr: tenant.nameAr },
      product: product ? { id: product.id, name: product.name, nameAr: product.nameAr, sizeMm: (product.dimensions as NonNullable<QaRow['product']>['sizeMm']) ?? null } : null,
      qaStatus: model.qaStatus as QaStatus, qaNotes: model.qaNotes,
      version: {
        id: version.id, number: version.version, polyCount: version.polyCount, sizeMm: mm(version.boundingBox),
        webBytes: fileFor(files, 'web')?.fileSizeBytes ?? null, readyAt: version.updatedAt.toISOString(),
      },
    });
  }
  return { rows, counts };
}

/**
 * Approve or reject. A rejection must say why — the merchant reads it. The decision is about the
 * newest ready version: if a newer one arrived since the reviewer opened it, that is a conflict.
 */
export async function decideQa(staff: StaffContext, modelId: string, input: { decision: 'approved' | 'rejected'; versionId: string; notes?: string }): Promise<QaRow['qaStatus']> {
  const notes = input.notes?.trim() ?? '';
  if (input.decision === 'rejected' && notes.length < 5) throw errors.validation({ notes: ['say what is wrong, in words the merchant can act on'] });
  const db = unsafeAdminDb();
  const [found] = await db.select({ model: models3d, tenant: tenants }).from(models3d)
    .innerJoin(tenants, eq(tenants.id, models3d.tenantId)).where(eq(models3d.id, modelId)).limit(1);
  if (!found) throw errors.notFound('model');
  if (found.model.source !== 'ai_generated') throw errors.conflict('only generated models are reviewed — an upload is the merchant’s own file');

  const ctx = staffActingContext(found.tenant, staff, ['models:read', 'models:write']);
  await withTenant(found.tenant.id, async (tdb) => {
    const before = await tdb.lockById(models3d, modelId);
    const [newest] = await tdb.find(modelVersions, and(eq(modelVersions.modelId, modelId), inArray(modelVersions.status, ['ready', 'processing'])), { limit: 1, orderBy: desc(modelVersions.version) });
    if (!newest || newest.status !== 'ready') throw errors.conflict('the model has no ready version to review yet');
    if (newest.id !== input.versionId) throw errors.conflict(`a newer version (v${newest.version}) arrived since this one was opened — review that one`);
    const after = await tdb.updateById(models3d, modelId, {
      qaStatus: input.decision, qaReviewedBy: staff.userId, qaNotes: notes || (input.decision === 'approved' ? null : before.qaNotes),
    });
    await record(ctx, { action: 'update', resourceType: 'model', resourceId: modelId, before: { qaStatus: before.qaStatus, qaNotes: before.qaNotes } as never, after: { qaStatus: after.qaStatus, qaNotes: after.qaNotes } as never }, tdb);
    await notifyIn(tdb, input.decision === 'approved'
      ? { type: 'model.qa_approved', permission: 'models:read', level: 'success', href: '/dashboard/models',
          title: { ar: `اعتُمد «${found.model.name}» ويمكن نشره`, en: `“${found.model.name}” was approved and can be published` }, body: null }
      : { type: 'model.qa_rejected', permission: 'models:read', level: 'warning', href: '/dashboard/models',
          title: { ar: `«${found.model.name}» يحتاج إلى تعديل`, en: `“${found.model.name}” needs changes` }, body: { ar: notes, en: notes } });
  });
  await staffLog(staff, {
    action: input.decision === 'approved' ? 'model.qa_approve' : 'model.qa_reject', targetType: 'model', targetId: modelId,
    storeId: found.tenant.id, reason: notes || null, detail: { versionId: input.versionId },
  });
  return input.decision;
}

/** The web file of a version, for the reviewer's viewer. Staff only (the handler checks). */
export async function qaModelFile(versionId: string): Promise<{ body: ReadableStream; size: number }> {
  const db = unsafeAdminDb();
  const [version] = await db.select().from(modelVersions).where(eq(modelVersions.id, versionId)).limit(1);
  if (!version || version.status !== 'ready') throw errors.notFound('model version');
  const files = await db.select().from(modelFiles).where(eq(modelFiles.modelVersionId, versionId));
  const web = fileFor(files, 'web');
  if (!web || web.bytesDeletedAt) throw errors.notFound('model file');
  const object = await forTenant(version.tenantId).get(web.storageKey);
  if (!object) throw errors.notFound('model file');
  return { body: object.body, size: object.meta.size };
}
