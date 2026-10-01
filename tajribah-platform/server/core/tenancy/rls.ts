/**
 * §7.1 — the row-level security wiring. Get this exactly right once.
 *
 * Every tenant-scoped query runs inside a transaction that has set `app.tenant_id`. The
 * policy on each table compares `tenant_id` with `current_tenant_id()`, so isolation is
 * enforced by Postgres and not by anyone remembering a `WHERE` clause.
 *
 * Four rules, each of which has cost someone a production incident:
 *
 *  1. **`set_config(..., true)` is transaction-local.** With a transaction-pooling
 *     connection pooler (PgBouncer, Hyperdrive), a session-local setting leaks to whoever
 *     gets that connection next. This is the single most dangerous bug available in this
 *     architecture, and it is why nothing outside this file may set the GUC.
 *  2. **The policy goes through `current_tenant_id()`, which uses `NULLIF`.** `COMMIT`
 *     resets a transaction-local GUC to the *empty string*, not NULL, so an inline
 *     `current_setting('app.tenant_id', true)::uuid` raises `invalid input syntax for type
 *     uuid` on the next query that runs without a tenant — a 500 instead of an empty
 *     result, and only after a connection has been reused (§13.1).
 *  3. **`FORCE ROW LEVEL SECURITY`**, or the table owner silently bypasses the policy.
 *  4. **The app connects as a non-owner, non-superuser role** (`tajribah_app`). A superuser
 *     ignores RLS entirely, which makes every test that ran as one meaningless (§13.2).
 */
import { sql } from 'drizzle-orm';
import { appDb, type Db } from '@/db/client';
import { TenantDb } from './tenant-db';

/** The GUC the policies read. Referenced in exactly two places: here and the migration. */
export const TENANT_GUC = 'app.tenant_id';

/**
 * Run `fn` with the tenant set for the life of one transaction.
 *
 * The callback gets a `TenantDb` bound to that transaction, so both layers apply: RLS
 * underneath, and the explicit predicate on top. Belt and braces is the intended end state,
 * not one or the other.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (db: TenantDb) => Promise<T>,
  handle: Db = appDb(),
): Promise<T> {
  if (!tenantId) throw new Error('withTenant requires a tenant id');
  return handle.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${TENANT_GUC}, ${tenantId}, true)`);
    return fn(TenantDb.for(tenantId, tx as unknown as Db));
  });
}

/**
 * One tenant's transaction for statements `TenantDb` cannot express (an aggregate written in SQL —
 * the analytics roll-up). The tenant is set exactly as in `withTenant`, on the same RLS-bound
 * handle, so Postgres confines every statement to that tenant's rows whatever the SQL says; the
 * caller still names the tenant in each statement (both layers, as everywhere).
 */
export async function withTenantSql<T>(tenantId: string, fn: (tx: Db) => Promise<T>, handle: Db = appDb()): Promise<T> {
  if (!tenantId) throw new Error('withTenantSql requires a tenant id');
  return handle.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${TENANT_GUC}, ${tenantId}, true)`);
    return fn(tx as unknown as Db);
  });
}

/**
 * Background work that legitimately spans tenants (rollups, cleanup) still has to say which
 * tenant each statement is for. This makes that explicit rather than reaching for the admin
 * client — §13.2: a helper that wraps an unscoped client scopes nothing.
 */
export async function forEachTenant<T>(
  tenantIds: readonly string[],
  fn: (db: TenantDb, tenantId: string) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  for (const tenantId of tenantIds) {
    results.push(await withTenant(tenantId, (db) => fn(db, tenantId)));
  }
  return results;
}

/** What Postgres currently thinks the tenant is. Tests and diagnostics only. */
export async function currentTenantId(handle: Db = appDb()): Promise<string | null> {
  const result = await handle.execute(sql`select current_tenant_id() as id`);
  const rows = (result as unknown as { rows?: { id: string | null }[] }).rows
    ?? (result as unknown as { id: string | null }[]);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return row?.id ?? null;
}
