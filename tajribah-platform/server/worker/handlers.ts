/**
 * Every job handler, registered in one place: the Workers-safe ones (`handlers-edge.ts`) and the
 * two that need Node — `sharp` is a native module, so image and model work cannot run on
 * Cloudflare Workers. A Node worker (`main.ts`, `runForever`) registers all of them.
 */
import { registerHandler } from '../core/jobs/runner';
import type { Job } from '@/db/schema';
import { handleProcessJob } from '@/server/modules/models/process';
import { handleQualityJob } from '@/server/modules/tryon/quality';
import { registerEdgeHandlers } from './handlers-edge';

export { NODE_ONLY_QUEUES, tenantOf } from './handlers-edge';

/** T57: only the jobs that need Node — what the Node worker beside Cloudflare runs. */
export function registerNodeHandlers(): void {
  registerHandler('ai.postprocess', (job: Job) => handleProcessJob(job));
  registerHandler('tryon.quality', (job: Job) => handleQualityJob(job));
}

export function registerAllHandlers(): void {
  registerEdgeHandlers();
  // P1.13: optimise a confirmed model upload (gltf-transform + sharp); P5.9: check a confirmed
  // try-on cut-out — crop empty edges, measure the size shown (sharp).
  registerNodeHandlers();
}
