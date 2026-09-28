/**
 * P1.6 — the `sync.products` queue handler.
 *
 * Runs up to `PAGES_PER_RUN` pages, then enqueues a continuation keyed by the cursor it
 * reached, so a 10,000-product import is many short jobs rather than one long one — and a
 * duplicate continuation is the same job (dedupe key), not a second sync.
 *
 * A store that is down throws: the queue retries with backoff and the next run resumes
 * from the stored cursor. On the last attempt the sync is marked failed first, so the
 * merchant sees "failed" instead of a sync that runs forever.
 */
import type { Job } from '@/db/schema';
import { enqueue } from '@/server/core/jobs/queue';
import { currentScope } from '@/server/core/observability/scope';
import { systemContext } from '@/server/core/tenancy/context';
import { markSyncFailed, runSyncStep, SYNC_PERMISSIONS } from './engine';
import { enqueueEdgeRefresh } from '@/server/modules/edge/publish';

export async function handleSyncJob(job: Job, options: { maxPages?: number } = {}): Promise<void> {
  const syncJobId = (job.payload as { syncJobId?: string } | null)?.syncJobId;
  if (!job.tenantId || !syncJobId) throw new Error(`sync job ${job.id} has no tenant or sync id`);
  const tenantId = job.tenantId;
  const requestId = currentScope()?.requestId ?? `job-${job.id}`;

  try {
    const { result, job: sync } = await runSyncStep({ tenantId, syncJobId, requestId, maxPages: options.maxPages });
    if (result === 'more' && sync) {
      await enqueue({ queue: 'sync.products', tenantId, payload: { syncJobId }, dedupeKey: `sync:${syncJobId}:${sync.cursor}` });
    }
    // P1.15: names, sizes and archived products change what published configs say.
    if (result === 'done') await enqueueEdgeRefresh(tenantId);
  } catch (error) {
    if (job.attempts >= job.maxAttempts) {
      const ctx = await systemContext({ tenantId, requestId, permissions: SYNC_PERMISSIONS });
      await markSyncFailed(ctx, syncJobId, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}
