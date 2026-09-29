/**
 * P7 — the wake-up for the job queue.
 *
 * Jobs are rows (T6); the row is the truth and a pass over the table is what runs them. A pass
 * happens every minute from the cron trigger whatever else happens. With `JOBS_MODE=cf-queue`
 * each new job also sends a small message to the Cloudflare queue bound as `JOBS`, whose consumer
 * runs a pass at once — so merchant-visible work (a sync, a publish) starts in seconds rather than
 * at the next minute, and Cloudflare adds consumers as the messages pile up (the autoscaling),
 * up to the consumer's `max_concurrency` (the ceiling that protects the database).
 *
 * A message carries no work, only "look now": losing one costs at most a minute, never a job, and
 * a failed send never fails the enqueue — the row is already written.
 */
import { log } from '../observability/log';

/** The part of a Cloudflare Queue producer binding we use. */
export type JobsQueue = { send(body: unknown, options?: { delaySeconds?: number }): Promise<unknown> };

/** Cloudflare Queues' longest delivery delay (12 hours). Later than that, the minute pass finds it. */
export const MAX_DELAY_SECONDS = 43_200;

let transport: JobsQueue | null = null;

export function configureJobs(config: { JOBS_MODE?: 'inline' | 'cf-queue' }, queue?: JobsQueue): void {
  if (config.JOBS_MODE !== 'cf-queue') { transport = null; return; }
  if (!queue) throw new Error('JOBS_MODE=cf-queue but no queue binding (JOBS) is bound to this Worker');
  transport = queue;
}

/** Ask a consumer to look now — or when the job falls due. Never throws. */
export async function nudge(job: { id: string; queue: string; runAfter: Date }, now = new Date()): Promise<void> {
  if (!transport) return;
  const delay = Math.ceil((job.runAfter.getTime() - now.getTime()) / 1000);
  if (delay > MAX_DELAY_SECONDS) return;
  try {
    await transport.send({ job: job.id, queue: job.queue }, delay > 0 ? { delaySeconds: delay } : undefined);
  } catch (error) {
    log.warn('job nudge failed; the next minute pass runs it', { jobId: job.id, queue: job.queue, error: error instanceof Error ? error.message : String(error) });
  }
}
