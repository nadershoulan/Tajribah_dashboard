/**
 * The worker process (§13.5).
 *
 * The first build made `apps/worker` a library with no entry point three separate times,
 * which meant every scheduled tick had nowhere to run while looking, in review, exactly
 * like working software. So this file exists now, with the first handler, and it is the
 * only place the loop lives.
 *
 * Two shapes, one body:
 *  - `runForever()` — a long-lived Node process (local, or a container).
 *  - `scheduled()`  — a Cloudflare Cron Trigger, which runs one tick and returns.
 */
import { tick } from '../core/jobs/runner';
import { log } from '../core/observability/log';
import { registerAllHandlers } from './handlers';
import { dispatchPending } from '@/server/modules/webhooks/dispatch';
import { scheduleSyncs } from '@/server/modules/sync/schedule';
import { expireStaleDrafts } from '@/server/modules/models/cleanup';
import { resealConnections } from '@/server/modules/connections/rotation';

export const WORKER_ID = `worker-${Math.random().toString(36).slice(2, 8)}`;

let registered = false;

function ensureHandlers(): void {
  if (registered) return;
  registerAllHandlers();
  registered = true;
}

/** One pass. This is what a cron trigger calls. */
export async function runOnce(limit = 10): Promise<void> {
  ensureHandlers();
  const result = await tick(WORKER_ID, limit);
  if (result.claimed > 0) log.info('worker tick', { worker: WORKER_ID, ...result });
  await dispatchWebhooks();
  await scheduled();
}

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

/** The database-driven sweeps: due syncs, abandoned draft uploads, tokens under an old key. */
async function scheduled(): Promise<void> {
  await scheduleSyncs();
  await expireStaleDrafts();
  await resealConnections();
}

/** Stored webhook deliveries are handled on the same tick as queue jobs (P1.7). */
async function dispatchWebhooks(): Promise<number> {
  const counts = await dispatchPending();
  const handled = counts.processed + counts.ignored + counts.retry + counts.failed;
  if (handled > 0) log.info('webhooks dispatched', { worker: WORKER_ID, ...counts });
  return handled;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
