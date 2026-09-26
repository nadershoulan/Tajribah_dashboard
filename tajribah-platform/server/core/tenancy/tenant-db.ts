/**
 * P0.5 — the tenant-scoped data layer. **The isolation guarantee lives here.**
 *
 * Postgres row-level security is the first line (see `rls.ts`). This is the second, and it
 * is not redundant: RLS protects the database, and this protects against a query that never
 * reaches the database with a tenant set — a background job, a migration script, a future
 * caching layer. Two independent mechanisms, both mandatory:
 *
 *   - A repository is constructed from a `TenantDb`, never from a raw handle.
 *   - Every method here injects `tenant_id = ?`. There is no method that does not.
 *   - `insert` refuses a row whose tenant is missing or different — it does not silently
 *     correct it, because a wrong tenant id in a payload means a bug upstream.
 *   - `update` refuses to change `tenant_id` at all. Moving a row between tenants is not
 *     an update; it does not exist.
 *
 * What this class deliberately does not have: a way to get the unscoped handle, and a
 * `raw()` escape hatch. Code that genuinely needs one calls `unsafeAdminDb()` directly, so
 * it is visible in review and greppable.
 *
 * Construct it through `withTenant()` (rls.ts) wherever a transaction is available, so the
 * database-level policy applies too.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, getTableColumns, getTableName, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { EXEMPT } from '@/db/schema';
import { errors } from '../errors/problem';

type Row<T extends PgTable> = InferSelectModel<T>;
type NewRow<T extends PgTable> = InferInsertModel<T>;

/** Which column carries the tenant for this table. `tenants` itself is keyed by `id`. */
function scopeColumnOf(table: PgTable): PgColumn {
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const tenantColumn = Object.values(columns).find((c) => c.name === 'tenant_id');
  if (tenantColumn) return tenantColumn;

  const name = getTableName(table);
  if (name === 'tenants' && columns.id) return columns.id;

  throw new Error(
    `Table "${name}" has no tenant column, so it cannot be reached through TenantDb.` +
    (EXEMPT[name]
      ? ` It is exempt: ${EXEMPT[name]} Use unsafeAdminDb() and filter explicitly.`
      : ` If that is intentional, add it to EXEMPT in db/schema/index.ts with the reason.`),
  );
}

export class TenantDb {
  readonly tenantId: string;
  private readonly db: Db;

  private constructor(tenantId: string, db: Db) {
    this.tenantId = tenantId;
    this.db = db;
  }

  /**
   * The only constructor. `tenantId` must come from a verified `TenantContext` — a
   * membership that was checked — never from a request body, query string or header.
   */
  static for(tenantId: string, db: Db = unsafeAdminDb()): TenantDb {
    if (!tenantId) throw new Error('TenantDb requires a tenant id');
    return new TenantDb(tenantId, db);
  }

  /** The tenant predicate, for repositories that build their own query (joins, unions). */
  scope(table: PgTable, extra?: SQL): SQL {
    const base = eq(scopeColumnOf(table), this.tenantId);
    return (extra ? and(base, extra) : base) as SQL;
  }

  async find<T extends PgTable>(
    table: T,
    where?: SQL,
    opts: { limit?: number; offset?: number; orderBy?: SQL | SQL[] } = {},
  ): Promise<Row<T>[]> {
    let query: any = this.db.select().from(table as any).where(this.scope(table, where));
    if (opts.orderBy) query = query.orderBy(...(Array.isArray(opts.orderBy) ? opts.orderBy : [opts.orderBy]));
    // No unbounded queries (§8): every list has a hard ceiling even when none was asked for.
    query = query.limit(opts.limit ?? 500);
    if (opts.offset) query = query.offset(opts.offset);
    return (await query) as Row<T>[];
  }

  async findOne<T extends PgTable>(table: T, where?: SQL): Promise<Row<T> | null> {
    const rows = await this.find(table, where, { limit: 1 });
    return rows[0] ?? null;
  }

  /**
   * Fetch by primary key within this tenant. A row belonging to another tenant comes back
   * as `null`, which the caller turns into a 404 — never a 403 (§13.6: do not confirm that
   * an id exists).
   */
  async findById<T extends PgTable>(table: T, id: string): Promise<Row<T> | null> {
    const columns = getTableColumns(table) as Record<string, PgColumn>;
    if (!columns.id) throw new Error(`Table "${getTableName(table)}" has no id column`);
    return this.findOne(table, eq(columns.id, id));
  }

  /** Like `findById`, but raises the 404 for you. Use in services that require the row. */
  async requireById<T extends PgTable>(table: T, id: string): Promise<Row<T>> {
    const row = await this.findById(table, id);
    if (!row) throw errors.notFound(getTableName(table));
    return row;
  }

  async count(table: PgTable, where?: SQL): Promise<number> {
    const rows: any = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(table as any)
      .where(this.scope(table, where));
    return Number(rows[0]?.n ?? 0);
  }

  /** P2.9 — `sum(column)` over this tenant's rows (0 when there are none). */
  async sum(table: PgTable, column: PgColumn, where?: SQL): Promise<number> {
    const rows: any = await this.db
      .select({ n: sql<string>`coalesce(sum(${column}), 0)` })
      .from(table as any)
      .where(this.scope(table, where));
    return Number(rows[0]?.n ?? 0);
  }

  async exists(table: PgTable, where?: SQL): Promise<boolean> {
    return (await this.count(table, where)) > 0;
  }

  async insert<T extends PgTable>(table: T, values: NewRow<T>): Promise<Row<T>>;
  async insert<T extends PgTable>(table: T, values: NewRow<T>[]): Promise<Row<T>[]>;
  async insert<T extends PgTable>(table: T, values: NewRow<T> | NewRow<T>[]): Promise<Row<T> | Row<T>[]> {
    const column = scopeColumnOf(table);
    const key = Object.entries(getTableColumns(table) as Record<string, PgColumn>)
      .find(([, c]) => c.name === column.name)![0];

    const list = (Array.isArray(values) ? values : [values]).map((row) => {
      const given = (row as any)[key];
      if (given !== undefined && given !== this.tenantId) {
        // Not corrected silently: a foreign tenant id in a payload is a bug, and hiding it
        // would turn a caught mistake into a cross-tenant write that looks fine in the log.
        throw new Error(
          `Refusing to insert into "${getTableName(table)}" with ${column.name}=${String(given)} ` +
          `while scoped to ${this.tenantId}`,
        );
      }
      return { ...row, [key]: this.tenantId };
    });

    const inserted: any = await this.db.insert(table as any).values(list as any).returning();
    return (Array.isArray(values) ? inserted : inserted[0]) as Row<T> | Row<T>[];
  }

  /**
   * P2.2 — insert, or on a conflict with `target` set `set` instead: one statement, so two racing
   * writers can neither both insert nor lose an update. The tenant column is forced as in
   * `insert`, and `target` must include it — the conflicting row can only be this tenant's.
   */
  async upsert<T extends PgTable>(table: T, values: NewRow<T>, target: PgColumn[], set: Partial<NewRow<T>>): Promise<Row<T>> {
    const column = scopeColumnOf(table);
    if (!target.some((c) => c.name === column.name)) {
      throw new Error(`upsert on "${getTableName(table)}" must name ${column.name} in its conflict target`);
    }
    const key = Object.entries(getTableColumns(table) as Record<string, PgColumn>).find(([, c]) => c.name === column.name)![0];
    if (key in (set as object)) {
      throw new Error(`Refusing to change ${column.name} on "${getTableName(table)}": rows do not move between tenants`);
    }
    const given = (values as any)[key];
    if (given !== undefined && given !== this.tenantId) {
      throw new Error(`Refusing to upsert into "${getTableName(table)}" with ${column.name}=${String(given)} while scoped to ${this.tenantId}`);
    }
    const [row]: any = await this.db.insert(table as any)
      .values({ ...values, [key]: this.tenantId } as any)
      .onConflictDoUpdate({ target: target as any, set: set as any })
      .returning();
    return row as Row<T>;
  }

  async update<T extends PgTable>(table: T, where: SQL, values: Partial<NewRow<T>>): Promise<Row<T>[]> {
    const column = scopeColumnOf(table);
    const key = Object.entries(getTableColumns(table) as Record<string, PgColumn>)
      .find(([, c]) => c.name === column.name)![0];
    if (key in (values as object)) {
      throw new Error(`Refusing to change ${column.name} on "${getTableName(table)}": rows do not move between tenants`);
    }
    const updated: any = await this.db
      .update(table as any)
      .set(values as any)
      .where(this.scope(table, where))
      .returning();
    return updated as Row<T>[];
  }

  /**
   * `SELECT … FOR UPDATE` on one row of this tenant. Only meaningful inside `withTenant`: the
   * lock lasts until that transaction ends, so a second caller waits and then reads what the
   * first one wrote. 404 if the row is not this tenant's.
   */
  async lockById<T extends PgTable>(table: T, id: string): Promise<Row<T>> {
    const columns = getTableColumns(table) as Record<string, PgColumn>;
    const rows: any = await this.db.select().from(table as any)
      .where(this.scope(table, eq(columns.id, id))).limit(1).for('update');
    if (!rows[0]) throw errors.notFound(getTableName(table));
    return rows[0] as Row<T>;
  }

  /**
   * `SELECT … FOR UPDATE SKIP LOCKED` on one row: the row, locked until the transaction
   * ends — or null if it is not this tenant's, or another worker already holds it. How a
   * worker claims one piece of work without a `processing` status (§13.6).
   */
  async tryLockById<T extends PgTable>(table: T, id: string): Promise<Row<T> | null> {
    const columns = getTableColumns(table) as Record<string, PgColumn>;
    const rows: any = await this.db.select().from(table as any)
      .where(this.scope(table, eq(columns.id, id))).limit(1).for('update', { skipLocked: true });
    return (rows[0] as Row<T>) ?? null;
  }

  async updateById<T extends PgTable>(table: T, id: string, values: Partial<NewRow<T>>): Promise<Row<T>> {
    const columns = getTableColumns(table) as Record<string, PgColumn>;
    const rows = await this.update(table, eq(columns.id, id), values);
    if (!rows[0]) throw errors.notFound(getTableName(table));
    return rows[0];
  }

  async delete<T extends PgTable>(table: T, where: SQL): Promise<number> {
    const deleted: any = await this.db.delete(table as any).where(this.scope(table, where)).returning();
    return Array.isArray(deleted) ? deleted.length : 0;
  }

  async deleteById(table: PgTable, id: string): Promise<boolean> {
    const columns = getTableColumns(table) as Record<string, PgColumn>;
    return (await this.delete(table as any, eq(columns.id, id))) > 0;
  }

  /**
   * Check that a referenced id belongs to this tenant before storing it — even when the
   * scope would have caught it later (§13.6). Fails as 404, not as a leak.
   */
  async assertOwned(table: PgTable, id: string | null | undefined, what = getTableName(table)): Promise<void> {
    if (!id) return;
    const columns = getTableColumns(table) as Record<string, PgColumn>;
    if (!(await this.exists(table, eq(columns.id, id)))) throw errors.notFound(what);
  }
}
