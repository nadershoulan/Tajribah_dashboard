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

/** Run `work` after the answer where the platform allows it; before it otherwise. A failure is logged, never thrown at the caller. */
export async function afterAnswer(label: string, work: () => Promise<unknown>): Promise<void> {
  const run = withDbConnection(work, { own: true }).catch((error) => {
    log.error('background work failed', { label, error: error instanceof Error ? error.message : String(error) });
  });
  if (runner) runner(run);
  else await run;
}
