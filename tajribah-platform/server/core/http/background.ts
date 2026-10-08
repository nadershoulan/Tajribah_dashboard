/**
 * P7 — work that may finish after the answer has gone.
 *
 * On Cloudflare the Worker hands it to the runtime's `waitUntil` (installed by `server/boot.ts`): the
 * answer leaves at once and the work keeps running, on its own database connections, until it settles.
 * Anywhere else (tests, a Node process) there is no runner and the work is simply done before the
 * answer — the same result, only slower to answer.
 */
import { withDbConnection } from '@/db/client';
import { log } from '@/server/core/observability/log';

type Runner = (work: Promise<unknown>) => void;
let runner: Runner | null = null;

/** Install (or, in tests, remove) the platform's way to keep work alive after the answer. */
export function setBackgroundRunner(next: Runner | null): void {
  runner = next;
}

/**
 * Run `work` after the answer where the platform allows it; before it otherwise. A failure is retried — up to
 * `attempts` in all, each on fresh connections, 250 ms then 1 s apart (the load test lost 10% of batches to
 * refused connections when none was retried) — then logged, never thrown at the caller. `work` must be safe to
 * run again: it is told which attempt this is, and keeps its own note of what is already done.
 */
export async function afterAnswer(label: string, work: (attempt: number) => Promise<unknown>, { attempts = 3, pauseMs = [250, 1000] }: { attempts?: number; pauseMs?: number[] } = {}): Promise<void> {
  const run = (async () => {
    for (let attempt = 1; ; attempt++) {
      try { await withDbConnection(() => work(attempt), { own: true }); return; }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= attempts) { log.error('background work failed', { label, attempts, error: message }); return; }
        log.warn('background work failed, trying again', { label, attempt, error: message });
        await new Promise((r) => setTimeout(r, pauseMs[Math.min(attempt - 1, pauseMs.length - 1)] ?? 0));
      }
    }
  })();
  if (runner) runner(run);
  else await run;
}
