/**
 * Every job handler the worker knows about, registered in one place.
 *
 * A handler is idempotent, takes its tenant from the payload, and never reaches tenant data
 * except through `TenantDb.for(payload.tenantId)` — a background job has no session, so it
 * cannot inherit a scope and must state one.
 */
import { TenantDb } from '../core/tenancy/tenant-db';
import { registerHandler } from '../core/jobs/runner';
import { log } from '../core/observability/log';
import type { Job } from '@/db/schema';
import { handleSyncJob } from '@/server/modules/sync/job';
import { handleProcessJob } from '@/server/modules/models/process';
import { handleAiJob } from '@/server/modules/ai-jobs/job';
import { handleQualityJob } from '@/server/modules/tryon/quality';

/** Read the tenant a job is for, refusing to run tenant work without one. */
export function tenantOf(job: Job): TenantDb {
  const tenantId = job.tenantId ?? (job.payload as { tenantId?: string } | null)?.tenantId;
  if (!tenantId) throw new Error(`job ${job.id} on "${job.queue}" has no tenant`);
  return TenantDb.for(tenantId);
}

export function registerAllHandlers(): void {
  registerHandler('system.cleanup', async (job: Job) => {
    log.info('cleanup tick', { jobId: job.id });
  });
  // P1.6. The edge handler arrives with its own package (P1.15).
  registerHandler('sync.products', (job: Job) => handleSyncJob(job));
  // P1.13: optimise a confirmed model upload.
  registerHandler('ai.postprocess', (job: Job) => handleProcessJob(job));
  // P3.2: AI jobs — the lifecycle runs whichever executor is registered for the job's type.
  registerHandler('ai.generate-3d', (job: Job) => handleAiJob(job));
  registerHandler('ai.embed', (job: Job) => handleAiJob(job));
  // P5.9: check a confirmed try-on cut-out — crop empty edges, measure the size shown.
  registerHandler('tryon.quality', (job: Job) => handleQualityJob(job));
}
