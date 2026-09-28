/**
 * T36 — a try-on picture that was replaced (a new upload, or the quality check's cropped copy).
 *
 * Its bytes go at once, unless the product is live on the shop (P1.15): then shoppers may still be
 * holding a config that names it — the live config is rewritten first, but a cached copy can be up
 * to a couple of minutes old — so it is deleted later (`LIVE_GRACE_MS`) by a queued job. The job
 * deletes nothing that became a current picture again.
 */
import { eq } from 'drizzle-orm';
import { tryonConfigs, type Job } from '@/db/schema';
import { enqueue } from '@/server/core/jobs/queue';
import { forTenant } from '@/server/core/storage/storage';
import { TenantDb } from '@/server/core/tenancy/tenant-db';
import { LIVE_GRACE_MS, isLive } from '@/server/modules/edge/publish';

export async function retireCutout(tenantId: string, productId: string, key: string, now = new Date()): Promise<'now' | 'later'> {
  if (await isLive(tenantId, productId)) {
    await enqueue({ queue: 'storage.delete-later', tenantId, payload: { productId, key }, runAfter: new Date(now.getTime() + LIVE_GRACE_MS), dedupeKey: `retire:${key}` });
    return 'later';
  }
  await forTenant(tenantId).delete(key).catch(() => undefined); // an orphan costs us, never the store
  return 'now';
}

export async function handleDeleteLater(job: Job): Promise<void> {
  const p = job.payload as { productId?: string; key?: string } | null;
  if (!job.tenantId || !p?.productId || !p.key) throw new Error(`delete-later job ${job.id} is missing its tenant, product or key`);
  const config = await TenantDb.for(job.tenantId).findOne(tryonConfigs, eq(tryonConfigs.productId, p.productId));
  if (config && (config.wornKey === p.key || config.flatKey === p.key)) return; // in use again: keep it
  await forTenant(job.tenantId).delete(p.key); // a foreign key is refused by the tenant's storage
}
