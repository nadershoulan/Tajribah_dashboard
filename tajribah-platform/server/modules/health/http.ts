/**
 * P7 — health, for the uptime monitor (plan §4: Better Stack, which drives the status page) and
 * for whoever is looking at a deploy.
 *
 *  - `GET /api/health` — alive: the Worker boots and answers. Nothing else is touched, so a
 *    monitor calling it every minute costs nothing.
 *  - `GET /api/health/ready` — able to do its work: the database answers `select 1` (within 2 s),
 *    and which adapters this environment runs (names only — never a secret or an address).
 *    503 while the database cannot answer, so the monitor and the status page say so.
 */
import { pingDb } from '@/db/client';
import { loadEnv } from '@/server/core/config/env';
import { json } from '@/server/core/http/api';
import { route } from '@/server/core/observability/request';

/** API-H01 — GET /api/health */
export const liveHandler = route(async () => json({ status: 'ok' }));

/** API-H02 — GET /api/health/ready */
export const readyHandler = route(async () => {
  const env = loadEnv();
  const database = await pingDb();
  const ready = database === 'ok';
  return json({
    status: ready ? 'ok' : 'unavailable',
    checks: { database },
    adapters: {
      environment: env.NODE_ENV, storage: env.STORAGE_PROVIDER, configs: env.CONFIG_STORE,
      rateLimits: env.RATE_LIMITER, jobs: env.JOBS_MODE,
    },
  }, { status: ready ? 200 : 503 });
});
