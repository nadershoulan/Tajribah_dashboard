/**
 * Uploads started and never confirmed, for the files with no row of their own until they are
 * attached: try-on pictures (`tryon/service.ts`) and model pictures (`models/picture.ts`). Model
 * files and AI photos have their own rows and sweeps (`models/cleanup.ts`, `ai-jobs/sweep.ts`).
 *
 * Start records the key; confirm takes it — first thing in the transaction that attaches the picture,
 * or before refused bytes are deleted. A confirm that finds no record is refused ("upload it again"):
 * the sweep took it, or the key was never handed out to this store. A record left past
 * `PENDING_UPLOAD_TTL_MS` is a tab closed mid-upload: the sweep removes it and then the bytes. A day, as for model drafts: the URL lives 15 minutes, so
 * nothing still uploading is touched. Bytes something attached are never deleted, whatever the record
 * says — the sweep looks before it deletes.
 */
import { asc, eq, lt, or } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { models3d, pendingUploads, tryonConfigs } from '@/db/schema';
import { log } from '@/server/core/observability/log';
import { forTenant } from '@/server/core/storage/storage';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';

export const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60_000;
export type PendingPurpose = 'tryon_cutout' | 'model_picture';

/** A confirm with no record: started more than a day ago (its bytes are swept), or never by this store. */
export const EXPIRED = 'this upload has expired — upload the picture again';

/** At start, before the upload URL is handed out. */
export async function notePendingUpload(tenantId: string, storageKey: string, purpose: PendingPurpose): Promise<void> {
  await withTenant(tenantId, (db) => db.insert(pendingUploads, { storageKey, purpose } as never));
}

/**
 * At confirm: takes the record, true if it was still there. Run it before attaching, in the same
 * transaction: if the sweep holds the record, this waits for it, then finds nothing.
 */
export async function takePendingUpload(db: TenantDb, storageKey: string): Promise<boolean> {
  return (await db.delete(pendingUploads, eq(pendingUploads.storageKey, storageKey))) > 0;
}

/** Whether a try-on config or a model names these bytes. */
async function attached(db: TenantDb, key: string): Promise<boolean> {
  return (await db.exists(tryonConfigs, or(eq(tryonConfigs.wornKey, key), eq(tryonConfigs.flatKey, key))))
    || db.exists(models3d, eq(models3d.pictureKey, key));
}

export async function sweepPendingUploads(now = new Date(), limit = 100): Promise<number> {
  // Platform sweep across tenants: ids, tenants and keys only; each change runs in its tenant.
  const stale = await unsafeAdminDb()
    .select({ id: pendingUploads.id, tenantId: pendingUploads.tenantId, storageKey: pendingUploads.storageKey })
    .from(pendingUploads)
    .where(lt(pendingUploads.createdAt, new Date(now.getTime() - PENDING_UPLOAD_TTL_MS)))
    .orderBy(asc(pendingUploads.createdAt))
    .limit(limit);

  let removed = 0;
  for (const { id, tenantId, storageKey } of stale) {
    try {
      const drop = await withTenant(tenantId, async (db) => {
        // Under the row's lock; one a confirm holds is skipped — that confirm is taking it.
        const row = await db.tryLockById(pendingUploads, id);
        if (!row) return false;
        await db.deleteById(pendingUploads, id);
        return !(await attached(db, storageKey));
      });
      if (!drop) continue;
      // After the commit. A delete that fails leaves an orphan we pay for, never the store.
      await forTenant(tenantId).delete(storageKey);
      removed++;
    } catch (error) {
      // One store (suspended, deleted) never stops the sweep.
      log.warn('pending upload sweep skipped one', { id, tenantId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (removed) log.info('unconfirmed uploads removed', { removed });
  return removed;
}
