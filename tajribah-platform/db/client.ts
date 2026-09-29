/**
 * The database handles, and the one place they are held.
 *
 * This file imports no driver, so a handle can be a pooled connection in production and an
 * in-process PGlite instance in tests. Whoever boots the process registers both.
 *
 * There are two, one per database role (§7.1):
 *
 *  - **app** (`tajribah_app`) — RLS applies. Reached only through `withTenant()`
 *    (server/core/tenancy/rls.ts), which sets the tenant for one transaction.
 *  - **admin** (`tajribah_admin`, BYPASSRLS) — for work that precedes or spans a tenant:
 *    registration, login's membership lookup, the job queue. The name `unsafeAdminDb` exists
 *    so that every such call site is visible in review and in grep.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema, any>;

let handles: { app: Db; admin: Db } | null = null;

export function registerDb(app: Db, admin: Db): void {
  handles = { app, admin };
}

export function isDbRegistered(): boolean {
  return handles !== null;
}

function requireDb(): { app: Db; admin: Db } {
  if (!handles) {
    throw new Error(
      'No database registered. The server registers a Postgres pool per role at boot; ' +
      'tests register an in-process PGlite instance in server/testing/harness.ts.',
    );
  }
  return handles;
}

/**
 * The RLS-bound handle. Only `withTenant()` should take it: a query on it with no tenant set
 * returns nothing, which is correct but never what the caller meant.
 */
export function appDb(): Db {
  return requireDb().app;
}

/**
 * The RLS-bypassing handle. Every call site must filter by tenant explicitly and say why it
 * is not going through `withTenant` — §13.2: a helper that wraps this client scopes nothing,
 * and naming it `withTenant` would make the name a lie.
 */
export function unsafeAdminDb(): Db {
  return requireDb().admin;
}

/**
 * P7 — can the database answer? `select 1` on the application handle, within `timeoutMs`. For the
 * readiness check only: it reads no table, so no tenant is needed.
 */
export async function pingDb(timeoutMs = 2000): Promise<'ok' | 'not_registered' | 'error'> {
  if (!handles) return 'not_registered';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'error'>((resolve) => { timer = setTimeout(() => resolve('error'), timeoutMs); });
  try {
    return await Promise.race([handles.app.execute(sql`select 1`).then(() => 'ok' as const), late]);
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

/** Tests only. */
export function clearDb(): void {
  handles = null;
}
