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

/** Read the tenant a job is for, refusing to run tenant work without one. */
export function tenantOf(job: Job): TenantDb {
  const tenantId = job.tenantId ?? (job.payload as { tenantId?: string } | null)?.tenantId;
  if (!tenantId) throw new Error(`job ${job.id} on "${job.queue}" has no tenant`);
  return TenantDb.for(tenantId);
}

export function registerAllHandlers(): void {
  // P0's only real handler: prove the loop runs end to end. The sync, AI and edge handlers
  // arrive with their own packages (P1.6, P3.2, P1.15) and register here.
  registerHandler('system.cleanup', async (job: Job) => {
    log.info('cleanup tick', { jobId: job.id });
  });
}
