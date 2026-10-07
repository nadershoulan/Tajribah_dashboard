/**
 * P7 — the one Worker (dashboard and, since it moved in, the website): vinext's own fetch handler,
 * behind the website's store-address redirect (T62), plus the two ways background work runs on
 * Cloudflare (the scheduled pass also sweeps expired QR photo transfers, P5.7):
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
import { sweepExpiredPairs } from '@site/lib/pair-sweep';
import { markStoreHost, siteHosts, storeHostRedirect } from '@site/lib/store-host';
import { isLocalHost } from '@site/lib/tryon-config';
import { keyOf, serveConfig } from '@/server/core/edge/host';

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
  fetch(request: Request, env: unknown, ctx: Ctx) {
    // T75: on this computer there is no config host (`cfg.tajribah.org`, its own Worker), so this one
    // answers its `/v1/{store}/{product}.json` from the configs it published — only when opened at
    // localhost or 127.0.0.1, so that a product can be published and tried here. Elsewhere: unchanged.
    const url = new URL(request.url);
    if (isLocalHost(url.hostname) && keyOf(url.pathname)) { bootOnce(); return serveConfig(request); }
    // T62 (the website, moved in): on a store's own address only its try-on and products' own pages are
    // served — the dashboard and the marketing pages are sent to Tajribah's own host (`SITE_HOSTS`).
    const hosts = siteHosts((env as { SITE_HOSTS?: string } | null)?.SITE_HOSTS);
    const elsewhere = storeHostRedirect(new URL(request.url), hosts);
    return elsewhere ? Response.redirect(elsewhere, 302) : handler.fetch(markStoreHost(request, hosts), env, ctx);
  },
  async scheduled(_event: unknown, _env: unknown, ctx?: Ctx) {
    // P5.7: QR photos never received are gone within a minute of their session expiring.
    const pairs = sweepExpiredPairs().catch((error) => console.error('QR photo sweep failed', error instanceof Error ? error.message : 'unknown'));
    if (ctx) ctx.waitUntil(pairs); else await pairs;
    await run('cron', () => runScheduledPass());
  },
  async queue(batch: Batch) {
    await run('queue', () => runQueuePass());
    batch.ackAll();
  },
};

export default worker;
