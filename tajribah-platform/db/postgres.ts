/**
 * P0.20 — the production database connection: PostgreSQL through node-postgres (`pg`), which runs on
 * Cloudflare Workers with `nodejs_compat` and behind Hyperdrive, Cloudflare's connection pooler.
 *
 * Two login users, one per role (T9, DECISIONS T60): `app` is a member of `tajribah_app`, so row-level
 * security applies to it; `admin` has BYPASSRLS itself (the attribute is not inherited through
 * membership) and is a member of `tajribah_admin`. A `SET ROLE` per session would not do: Hyperdrive
 * pools by transaction, so session settings do not survive — the reason tenancy uses a
 * transaction-local setting too (`server/core/tenancy/rls.ts`).
 *
 * One connection per role per unit of work (`max: 1`), as the tests' single PGlite connection: a query
 * made outside its own transaction waits visibly instead of running without the store's setting.
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import type { Db, DbConnection } from './client';

export type PostgresUrls = { app: string; admin: string };

export function postgresConnector(urls: PostgresUrls): () => DbConnection {
  return () => {
    const app = new Pool({ connectionString: urls.app, max: 1 });
    const admin = new Pool({ connectionString: urls.admin, max: 1 });
    return {
      app: drizzle(app, { schema }) as unknown as Db,
      admin: drizzle(admin, { schema }) as unknown as Db,
      end: async () => { await Promise.all([app.end(), admin.end()]); },
    };
  };
}
