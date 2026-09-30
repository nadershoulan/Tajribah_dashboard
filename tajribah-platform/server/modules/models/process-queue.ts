/**
 * P1.13 — asking for a confirmed upload to be optimised. Apart from the job itself (`process.ts`,
 * which loads `sharp`): the upload endpoints run on Cloudflare Workers; the job runs on a Node worker.
 */
import { enqueue } from '@/server/core/jobs/queue';

export async function enqueueProcessing(tenantId: string, versionId: string): Promise<void> {
  await enqueue({ queue: 'ai.postprocess', tenantId, payload: { versionId }, dedupeKey: `model:${versionId}:process` });
}
