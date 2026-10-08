/**
 * The handler registry and the run loop body.
 *
 * Every handler must be idempotent: a job can be delivered twice (a worker dies after the
 * work but before `complete`), and the framework guarantees at-least-once, never
 * exactly-once. Every handler receives the tenant id in its payload and must use it.
 */
import { opensConnectionsPerUnit, withDbConnection } from '@/db/client';
import { claim, complete, fail, releaseStale, start, type QueueName } from './queue';
import type { Job } from '@/db/schema';
import { log } from '../observability/log';
import { runInScope } from '../observability/scope';

export type JobHandler = (job: Job) => Promise<void>;

const handlers = new Map<QueueName, JobHandler>();

export function registerHandler(queue: QueueName, handler: JobHandler): void {
  if (handlers.has(queue)) throw new Error(`Handler for "${queue}" is already registered`);
  handlers.set(queue, handler);
}

export function registeredQueues(): QueueName[] {
  return [...handlers.keys()];
}

/** Tests only. */
export function clearHandlers(): void {
  handlers.clear();
}

export type TickResult = { claimed: number; done: number; failed: number };

/**
 * P7 (found by the ingest load test): on Cloudflare every query crosses to the database server and back, so a
 * batch run one job after another spent ~2 s a job waiting — 10 roll-ups a minute against the 40 a minute that
 * 200 busy stores need. There a batch's jobs run up to this many at a time, each on its own connections (one
 * connection cannot hold two transactions at once). In tests and the Node process they run one by one, as before.
 */
export const JOB_CONCURRENCY = 4;

/** One pass: reclaim abandoned work, take a fair batch, run it. */
export async function tick(worker: string, limit = 10): Promise<TickResult> {
  await releaseStale();

  const batch = await claim({ worker, queues: registeredQueues(), limit });
  const result: TickResult = { claimed: batch.length, done: 0, failed: 0 };

  // Each job runs in its own scope: the originating request's id when there was one, so
  // "what did request X cause" includes the background work.
  const run = (job: Job) => {
    const requestId = (job.payload as { _requestId?: string } | null)?._requestId ?? `job-${job.id}`;
    return runInScope({ requestId, jobId: job.id, tenantId: job.tenantId }, () => runOne(job, result));
  };
  if (!opensConnectionsPerUnit()) {
    for (const job of batch) await run(job);
  } else {
    let next = 0;
    const lane = async () => { while (next < batch.length) { const job = batch[next++]!; await withDbConnection(() => run(job), { own: true }); } };
    await Promise.all(Array.from({ length: Math.min(JOB_CONCURRENCY, batch.length) }, lane));
  }

  return result;
}

async function runOne(job: Job, result: TickResult): Promise<void> {
  const handler = handlers.get(job.queue as QueueName);
  if (!handler) {
    // Registered queues were requested, so this means the registry changed mid-batch.
    await fail(job.id, new Error(`no handler for queue "${job.queue}"`));
    result.failed++;
    return;
  }
  try {
    await start(job.id);
    await handler(job);
    await complete(job.id);
    result.done++;
  } catch (error) {
    const state = await fail(job.id, error);
    result.failed++;
    log.error('job failed', {
      jobId: job.id, queue: job.queue, tenantId: job.tenantId, attempts: job.attempts, state,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type DrainResult = TickResult & { batches: number; extra: number; stoppedBy: 'idle' | 'budget'; ms: number };

/**
 * P7 — backpressure. Run fair batches until there is nothing left to do or the time budget is
 * spent, whichever comes first. The budget is checked before each new batch, never inside one: a
 * job is not abandoned half done (its lease covers an overrun). What is left waits for the next
 * pass — a queue message or the next minute — instead of one invocation running past its limits.
 * `extra` is other work that shares the pass (stored incoming webhooks), counted as busy.
 */
export async function drain(options: {
  worker: string; budgetMs: number; batch?: number;
  extra?: () => Promise<number>; clock?: () => number;
}): Promise<DrainResult> {
  const clock = options.clock ?? Date.now;
  const started = clock();
  const result: DrainResult = { claimed: 0, done: 0, failed: 0, batches: 0, extra: 0, stoppedBy: 'idle', ms: 0 };
  for (;;) {
    if (clock() - started >= options.budgetMs) { result.stoppedBy = 'budget'; break; }
    const batch = await tick(options.worker, options.batch ?? 10);
    const extra = options.extra ? await options.extra() : 0;
    result.batches++;
    result.claimed += batch.claimed; result.done += batch.done; result.failed += batch.failed; result.extra += extra;
    if (batch.claimed === 0 && extra === 0) break;
  }
  result.ms = clock() - started;
  return result;
}
