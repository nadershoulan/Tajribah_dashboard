/**
 * P3.2 — the queue handler for `ai.generate-3d` and `ai.embed`: one delivery of one AI job.
 * The lifecycle decides everything; this only reads the payload and says which attempt it is.
 */
import type { Job } from '@/db/schema';
import { currentScope } from '@/server/core/observability/scope';
import { runAiJob } from './lifecycle';

export async function handleAiJob(job: Job): Promise<void> {
  const aiJobId = (job.payload as { aiJobId?: string } | null)?.aiJobId;
  if (!job.tenantId || !aiJobId) throw new Error(`ai job ${job.id} has no tenant or ai job id`);
  await runAiJob({
    tenantId: job.tenantId, aiJobId, attempt: job.attempts, maxAttempts: job.maxAttempts,
    requestId: currentScope()?.requestId ?? `job-${job.id}`,
  });
}
