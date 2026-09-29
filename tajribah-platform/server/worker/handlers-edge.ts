/**
 * The job handlers that run on Cloudflare Workers (P7) — everything but image and model work.
 *
 * A handler is idempotent, takes its tenant from the payload, and never reaches tenant data
 * except through `TenantDb.for(payload.tenantId)` — a background job has no session, so it
 * cannot inherit a scope and must state one.
 *
 * Nothing here may import `sharp` (native) or the model optimiser: the Worker bundle would fail
 * at start-up. Those handlers live in `handlers.ts`, for a Node worker. A runtime claims only the
 * queues it has handlers for (`claim({ queues: registeredQueues() })`), so the Worker leaves
 * `ai.postprocess` and `tryon.quality` queued for the Node worker rather than failing them.
 */
import { TenantDb } from '../core/tenancy/tenant-db';
import { registerHandler } from '../core/jobs/runner';
import { log } from '../core/observability/log';
import type { Job } from '@/db/schema';
import type { QueueName } from '../core/jobs/queue';
import { handleSyncJob } from '@/server/modules/sync/job';
import { handleAiJob } from '@/server/modules/ai-jobs/job';
import { handleEdgeJob } from '@/server/modules/edge/publish';
import { handleDeleteLater } from '@/server/modules/tryon/retire';
import { handleWebhookDelivery } from '@/server/modules/outgoing-webhooks/deliver';
import { registerAllConnectors } from '@/server/connectors';

/** Queues only a Node worker can run (`handlers.ts`). */
export const NODE_ONLY_QUEUES: QueueName[] = ['ai.postprocess', 'tryon.quality'];

/** Read the tenant a job is for, refusing to run tenant work without one. */
export function tenantOf(job: Job): TenantDb {
  const tenantId = job.tenantId ?? (job.payload as { tenantId?: string } | null)?.tenantId;
  if (!tenantId) throw new Error(`job ${job.id} on "${job.queue}" has no tenant`);
  return TenantDb.for(tenantId);
}

export function registerEdgeHandlers(): void {
  registerAllConnectors(); // the sync jobs below read stores through them
  registerHandler('system.cleanup', async (job: Job) => {
    log.info('cleanup tick', { jobId: job.id });
  });
  // P1.6.
  registerHandler('sync.products', (job: Job) => handleSyncJob(job));
  // P3.2: AI jobs — the lifecycle runs whichever executor is registered for the job's type.
  registerHandler('ai.generate-3d', (job: Job) => handleAiJob(job));
  registerHandler('ai.embed', (job: Job) => handleAiJob(job));
  // P1.15: keep live viewer configs true after a change — rewrite, or withdraw.
  registerHandler('edge.publish-config', (job: Job) => handleEdgeJob(job));
  // T36: a replaced try-on picture a live config may still name, deleted after the grace period.
  registerHandler('storage.delete-later', (job: Job) => handleDeleteLater(job));
  // P8: one try of one outgoing webhook delivery (it schedules its own retries).
  registerHandler('webhooks.deliver', (job: Job) => handleWebhookDelivery(job));
}
