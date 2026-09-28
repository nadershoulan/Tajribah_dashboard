/**
 * The try-on site's worker: vinext's own fetch handler, unchanged, plus a scheduled sweep of
 * expired QR photo-transfer sessions (P5.7, `lib/pair-sweep.ts`). vinext documents delegating to
 * its handler from a custom worker exactly like this.
 */
import handler from 'vinext/server/fetch-handler';
import { sweepExpiredPairs } from '../lib/pair-sweep';

type Ctx = { waitUntil(promise: Promise<unknown>): void };

const worker = {
  fetch: (request: Request, env: unknown, ctx: Ctx) => handler.fetch(request, env, ctx),
  async scheduled(_event: unknown, _env: unknown, ctx: Ctx) {
    ctx.waitUntil(sweepExpiredPairs().catch((error) => console.error('QR photo sweep failed', error instanceof Error ? error.message : 'unknown')));
  },
};

export default worker;
