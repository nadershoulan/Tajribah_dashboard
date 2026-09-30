/**
 * T57 — the Node worker: the two kinds of background work Cloudflare Workers cannot run, because they
 * need `sharp` (a native module): optimising an uploaded 3D model (`ai.postprocess`) and checking a
 * try-on picture (`tryon.quality`). Everything else — every other queue and every sweep — runs on the
 * Cloudflare Worker (`entry.ts`); a runtime claims only the queues it has handlers for, so the two never
 * take each other's work.
 *
 * It has no Cloudflare bindings, so it does not boot like the Worker: it validates the same
 * environment, reaches the bucket through R2's S3 API (`STORAGE_PROVIDER=s3`), keeps its own database
 * pools for its whole life (a Node process may, unlike a Worker), and sends mail as configured.
 *
 *   node scripts/worker-node.mjs      (builds this file, then runs it; environment as the dashboard's)
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/db/schema';
import { registerDb, type Db } from '@/db/client';
import { loadEnv } from '@/server/core/config/env';
import { configureNotify } from '@/server/core/notify/notify';
import { configureStorage } from '@/server/core/storage/storage';
import { log, setLogLevel } from '@/server/core/observability/log';
import { registerNodeHandlers } from './handlers';
import { chooseHandlers } from './passes';
import { runForever } from './main';

const env = loadEnv(process.env);
setLogLevel(env.LOG_LEVEL);
if (env.STORAGE_PROVIDER !== 's3') throw new Error('the Node worker reaches the bucket through the S3 API: set STORAGE_PROVIDER=s3 and the R2_* credentials');
if (!env.DATABASE_APP_URL || !env.DATABASE_ADMIN_URL) throw new Error('the Node worker needs DATABASE_APP_URL and DATABASE_ADMIN_URL');
configureNotify(env);
configureStorage(env);
const pool = (url: string) => new Pool({ connectionString: url, max: 4 });
registerDb(drizzle(pool(env.DATABASE_APP_URL), { schema }) as unknown as Db, drizzle(pool(env.DATABASE_ADMIN_URL), { schema }) as unknown as Db);
chooseHandlers(registerNodeHandlers); // after main.ts chose every handler on import: this one runs only the Node jobs
log.info('node worker starting', { queues: 'ai.postprocess, tryon.quality' });
await runForever({ intervalMs: Number(process.env.WORKER_INTERVAL_MS ?? 1000), sweeps: false });
