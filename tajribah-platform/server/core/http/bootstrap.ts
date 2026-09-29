/**
 * P0.19 — process start-up, once per Worker isolate.
 *
 * Takes the Worker's bindings (plain-string vars and secrets, plus objects such as the R2
 * bucket), validates the environment — throwing with every problem at once — and installs
 * the adapters the environment names. Kept free of `cloudflare:workers` so it runs in tests;
 * `server/boot.ts` is the one file that imports the Workers runtime.
 *
 * The database is **not** registered here yet: the production Postgres host and driver are
 * an open decision (DECISIONS T9). Until then the first query fails with the "No database
 * registered" message from db/client.ts — loudly, rather than pretending.
 */
import { loadEnv, type Env } from '../config/env';
import { configureNotify } from '../notify/notify';
import { configureStorage } from '../storage/storage';
import { configureConfigStore, type KvBinding } from '../edge/configs';
import { configureRateLimiter, type RateLimitKv } from '../ratelimit/limiter';
import { registerAllConnectors } from '../../connectors';
import { setLogLevel } from '../observability/log';

export function bootstrap(bindings: Record<string, unknown>, fallback: Record<string, string | undefined> = {}): Env {
  const vars: Record<string, string | undefined> = { ...fallback };
  for (const [name, value] of Object.entries(bindings)) {
    if (typeof value === 'string') vars[name] = value;
  }
  const env = loadEnv(vars);
  setLogLevel(env.LOG_LEVEL);
  configureNotify(env);
  configureStorage(env, bindings.BUCKET as R2Bucket | undefined);
  configureConfigStore(env, bindings.CONFIGS as KvBinding | undefined);
  configureRateLimiter(env, bindings.RATE_LIMITS as RateLimitKv | undefined);
  registerAllConnectors(); // P6: the store connectors (WooCommerce first)
  return env;
}
