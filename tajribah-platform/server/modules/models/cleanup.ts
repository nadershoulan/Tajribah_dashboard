/**
 * Abandoned uploads (filed under P1.12): `startUpload` makes a `draft` version and a URL
 * that expires after 15 minutes. If the merchant closes the tab, nothing ever confirms it,
 * and the draft would sit in the library forever — with any bytes that did arrive.
 *
 * The worker's schedule tick fails drafts older than `DRAFT_TTL_MS` and deletes their bytes.
 * A day, not 15 minutes: a slow upload on a phone must never be failed under the merchant.
 * Each draft is re-checked under a row lock, so a confirm racing the cleanup wins or loses
 * cleanly — never both.
 */
import { and, asc, eq, lt } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { modelFiles, models3d, modelVersions } from '@/db/schema';
import { record } from '@/server/core/audit/audit';
import { log } from '@/server/core/observability/log';
import { forTenant } from '@/server/core/storage/storage';
import { systemContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';

export const DRAFT_TTL_MS = 24 * 60 * 60_000;

export async function expireStaleDrafts(now = new Date(), limit = 100): Promise<{ expired: number }> {
  // Platform sweep across tenants: ids and tenants only; each change runs in its tenant.
  const stale = await unsafeAdminDb()
    .select({ id: modelVersions.id, tenantId: modelVersions.tenantId })
    .from(modelVersions)
    .where(and(eq(modelVersions.status, 'draft'), lt(modelVersions.createdAt, new Date(now.getTime() - DRAFT_TTL_MS))))
    .orderBy(asc(modelVersions.createdAt))
    .limit(limit);

  let expired = 0;
  for (const { id, tenantId } of stale) {
    try {
      const ctx = await systemContext({ tenantId, requestId: `draft-expiry-${id}`, permissions: ['models:write'] });
      const keys = await withTenant(tenantId, async (db) => {
        const before = await db.lockById(modelVersions, id);
        if (before.status !== 'draft') return null; // confirmed in between
        const after = await db.updateById(modelVersions, id, { status: 'failed', error: 'upload never confirmed' });
        const model = await db.requireById(models3d, before.modelId);
        // Only a model still waiting on its first upload shows it failed; a live one stays live.
        if (!model.currentVersionId && model.status === 'draft') await db.updateById(models3d, model.id, { status: 'failed' });
        await record(ctx, { action: 'update', resourceType: 'model_version', resourceId: id, before, after }, db);
        const files = await db.find(modelFiles, eq(modelFiles.modelVersionId, id), { limit: 10 });
        return files.map((f) => f.storageKey);
      });
      if (!keys) continue;
      // After the commit: a rollback must not leave a version pointing at deleted bytes.
      const store = forTenant(tenantId);
      for (const key of keys) await store.delete(key);
      expired += 1;
    } catch (error) {
      // One store (suspended, deleted) never stops the sweep.
      log.warn('draft expiry skipped a version', { versionId: id, tenantId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (expired) log.info('stale drafts expired', { expired });
  return { expired };
}
