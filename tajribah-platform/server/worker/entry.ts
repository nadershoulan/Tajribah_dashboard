/**
 * P7 — the dashboard Worker: vinext's own fetch handler, unchanged, plus the two ways background
 * work runs on Cloudflare (the same wrapping the website uses, `tajribah-try-on/worker/index.ts`):
 *
 *  - `scheduled` — the every-minute Cron Trigger: the sweeps, then drain the job queue. It runs
 *    whatever else happens, so nothing depends on a message arriving.
 *  - `queue`     — the consumer of the `JOBS` queue. Each new job sends one message (`nudge.ts`);
 *    the consumer drains the queue, so work starts within seconds, and Cloudflare adds consumers
 *    as messages pile up, up to the consumer's `max_concurrency` (`docs/GO-LIVE.md` §3).
 *
 * Messages carry no work, so every batch is acknowledged, even when the pass fails: the rows are
 * the truth and the next minute tries again. A pass that throws is logged, never rethrown.
 */
import handler from 'vinext/server/fetch-handler';
import { bootOnce } from '@/server/boot';
import { log } from '@/server/core/observability/log';
import { withDbConnection } from '@/db/client';
import { registerEdgeHandlers } from './handlers-edge';
import { runQueuePass, runScheduledPass, chooseHandlers } from './passes';

// Never `./main` or `./handlers`: they import `sharp`, which cannot load in a Worker.
chooseHandlers(registerEdgeHandlers);

type Ctx = { waitUntil(promise: Promise<unknown>): void };
type Batch = { messages: readonly unknown[]; ackAll(): void };

async function run(kind: 'cron' | 'queue', pass: () => Promise<unknown>): Promise<void> {
  try {
    bootOnce();
    await withDbConnection(pass); // one pass, one connection per role, ended with it
  } catch (error) {
    log.error('worker pass failed', { kind, error: error instanceof Error ? error.message : String(error) });
  }
}

const worker = {
  fetch: (request: Request, env: unknown, ctx: Ctx) => handler.fetch(request, env, ctx),
  async scheduled() {
    await run('cron', () => runScheduledPass());
  },
  async queue(batch: Batch) {
    await run('queue', () => runQueuePass());
    batch.ackAll();
  },
};

export default worker;
