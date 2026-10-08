/**
 * The database handles, and the one place they are held.
 *
 * This file imports no driver, so a handle can be a pooled connection in production and an
 * in-process PGlite instance in tests. Whoever boots the process registers both.
 *
 * Two ways to register (P0.20):
 *  - **`registerDb(app, admin)`** — two handles for the whole process: the tests (PGlite), and a
 *    long-lived Node worker with its own pools.
 *  - **`registerDbConnector(connect)`** — on Cloudflare Workers, where a connection opened for one
 *    request cannot be used by another. Each request (`route`) and each background pass runs inside
 *    `withDbConnection`, which opens one connection per role on first use and ends them when the
 *    work ends. Code below never sees the difference: `appDb()` / `unsafeAdminDb()` as before.
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
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema, any>;

let handles: { app: Db; admin: Db } | null = null;

/** One unit of work's connections: a handle per role, and how to end them. */
export type DbConnection = { app: Db; admin: Db; end(): Promise<void> };
let connector: (() => DbConnection) | null = null;
const connections = new AsyncLocalStorage<{ open: DbConnection | null }>();

export function registerDb(app: Db, admin: Db): void {
  handles = { app, admin };
}

/** Workers: how to open a unit of work's connections (lazily, on its first query). */
export function registerDbConnector(connect: (() => DbConnection) | null): void {
  connector = connect;
}

export function isDbRegistered(): boolean {
  return handles !== null || connector !== null;
}

/**
 * Run `fn` as one unit of work: with a connector registered, its queries share connections opened
 * on first use and ended when it settles. Nested calls share the outer one; without a connector
 * (tests, a Node process) it is only `fn()`.
 *
 * `own` (P7): work that runs after the answer has gone (`afterAnswer`) — the request's connections are
 * ended with the request, so it opens its own instead of sharing them.
 */
export async function withDbConnection<T>(fn: () => Promise<T>, { own = false }: { own?: boolean } = {}): Promise<T> {
  if (!connector || (connections.getStore() && !own)) return fn();
  const slot: { open: DbConnection | null } = { open: null };
  try {
    return await connections.run(slot, fn);
  } finally {
    await slot.open?.end().catch(() => {}); // a connection that will not close must not fail the answer
  }
}

function requireDb(): { app: Db; admin: Db } {
  if (handles) return handles;
  if (connector) {
    const slot = connections.getStore();
    if (!slot) throw new Error('A query ran outside a unit of work: wrap its entry point in withDbConnection().');
    slot.open ??= connector();
    return slot.open;
  }
  throw new Error(
    'No database registered. The server registers a Postgres pool per role at boot; ' +
    'tests register an in-process PGlite instance in server/testing/harness.ts.',
  );
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
  if (!isDbRegistered()) return 'not_registered';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'error'>((resolve) => { timer = setTimeout(() => resolve('error'), timeoutMs); });
  try {
    return await Promise.race([requireDb().app.execute(sql`select 1`).then(() => 'ok' as const), late]);
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

/** Tests only. */
export function clearDb(): void {
  handles = null;
  connector = null;
}
