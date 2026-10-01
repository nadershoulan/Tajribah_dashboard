/**
 * P0.19 — process start-up, once per Worker isolate.
 *
 * Takes the Worker's bindings (plain-string vars and secrets, plus objects such as the R2
 * bucket), validates the environment — throwing with every problem at once — and installs
 * the adapters the environment names. Kept free of `cloudflare:workers` so it runs in tests;
 * `server/boot.ts` is the one file that imports the Workers runtime.
 *
 * P0.20: the database — Hyperdrive bindings (`HYPERDRIVE_APP`, `HYPERDRIVE_ADMIN`) on Cloudflare, or
 * `DATABASE_APP_URL` / `DATABASE_ADMIN_URL` — becomes a connector: a connection per role for each
 * unit of work (`db/client.ts`). Production refuses to start without one. Without one elsewhere,
 * the first query fails with "No database registered" — loudly, rather than pretending.
 */
import { loadEnv, type Env } from '../config/env';
import { configureNotify } from '../notify/notify';
import { configureStorage } from '../storage/storage';
import { configureConfigStore, type KvBinding } from '../edge/configs';
import { configureCustomHostnames } from '../edge/custom-hostnames';
import { configureRateLimiter, type RateLimitKv } from '../ratelimit/limiter';
import { configureJobs, type JobsQueue } from '../jobs/nudge';
import { registerWebhookSource } from '../../modules/webhooks/sources';
import { shopifySource } from '../../modules/webhooks/shopify';
import { sallaSource } from '../../modules/webhooks/salla';
import { zidSource } from '../../modules/webhooks/zid';
import { registerAllConnectors } from '../../connectors';
import { setLogLevel } from '../observability/log';
import { registerDbConnector } from '../../../db/client';
import { postgresConnector } from '../../../db/postgres';

type Hyperdrive = { connectionString: string };

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
  configureJobs(env, bindings.JOBS as JobsQueue | undefined); // P7: the job queue's wake-up
  const app = (bindings.HYPERDRIVE_APP as Hyperdrive | undefined)?.connectionString ?? env.DATABASE_APP_URL;
  const admin = (bindings.HYPERDRIVE_ADMIN as Hyperdrive | undefined)?.connectionString ?? env.DATABASE_ADMIN_URL;
  if (app && admin) registerDbConnector(postgresConnector({ app, admin }));
  else if (env.NODE_ENV === 'production') throw new Error('no database: bind HYPERDRIVE_APP and HYPERDRIVE_ADMIN (or set DATABASE_APP_URL and DATABASE_ADMIN_URL)');
  configureCustomHostnames(env); // T62: the edge that serves stores' own addresses, once the zone is set
  registerAllConnectors(); // P6: the store connectors (WooCommerce first)
  if (env.SHOPIFY_CLIENT_SECRET) registerWebhookSource(shopifySource(env.SHOPIFY_CLIENT_SECRET)); // P6: Shopify's webhooks
  if (env.SALLA_WEBHOOK_SECRET) registerWebhookSource(sallaSource(env.SALLA_WEBHOOK_SECRET)); // T61: Salla's webhooks
  if (env.ZID_CLIENT_SECRET) registerWebhookSource(zidSource(env.ZID_CLIENT_SECRET)); // T61: Zid's webhooks (Basic auth per store and event)
  return env;
}
