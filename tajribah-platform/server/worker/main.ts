/**
 * The worker process (§13.5).
 *
 * The first build made `apps/worker` a library with no entry point three separate times,
 * which meant every scheduled tick had nowhere to run while looking, in review, exactly
 * like working software. So this file exists now, with the first handler, and it is the
 * only place the loop lives.
 *
 * Three shapes, one body (`passes.ts`):
 *  - `runScheduledPass()` — the every-minute Cron Trigger: the sweeps, then drain the queue.
 *  - `runQueuePass()`     — the `JOBS` queue consumer: a new job's nudge; drain the queue.
 *  - `runForever()`       — a long-lived Node process (local, or a container).
 * P7: on Cloudflare, `entry.ts` runs the first two with the Workers-safe handlers only. This file
 * registers every handler, including the two that need Node (`sharp`): `ai.postprocess` and
 * `tryon.quality` run only where this file runs.
 */
import { tick } from '../core/jobs/runner';
import { log } from '../core/observability/log';
import { registerAllHandlers } from './handlers';
import { WORKER_ID, dispatchWebhooks, ensureHandlers, scheduled, chooseHandlers } from './passes';

export * from './passes';

chooseHandlers(registerAllHandlers);

/** The long-lived loop. Sleeps when idle rather than spinning. */
export async function runForever(options: { intervalMs?: number; limit?: number } = {}): Promise<void> {
  const interval = options.intervalMs ?? 1000;
  ensureHandlers();
  log.info('worker started', { worker: WORKER_ID, queues: 'all registered' });
  let lastSchedule = 0;

  while (true) {
    try {
      const result = await tick(WORKER_ID, options.limit ?? 10);
      const webhooks = await dispatchWebhooks();
      // The schedule is a database read; once a minute is plenty for a long-lived loop.
      if (Date.now() - lastSchedule >= 60_000) { lastSchedule = Date.now(); await scheduled(); }
      if (result.claimed === 0 && webhooks === 0) await sleep(interval);
    } catch (error) {
      log.error('worker tick threw', { worker: WORKER_ID, error: String(error) });
      await sleep(interval * 5);
    }
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
