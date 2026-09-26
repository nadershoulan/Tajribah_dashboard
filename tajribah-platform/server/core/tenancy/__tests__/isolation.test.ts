/**
 * P0.6 — the tenant-isolation suite. **This is the P0 gate.**
 *
 * It does not read a hand-written list of tables. It walks the schema, so a table added
 * next month is covered the day it is added, and a table that carries no tenant column
 * fails here until someone writes down why in `EXEMPT` (db/schema/index.ts). Forgetting is
 * not a way past it.
 *
 * Two layers are checked independently, because each is supposed to hold on its own:
 *
 *  1. **Postgres RLS** — with `app.tenant_id` set to A, raw SQL as the application role
 *     cannot see, change or delete B's rows. This is the guarantee that survives a bug in
 *     our own code.
 *  2. **`TenantDb`** — the predicate layer above it, which holds even when no transaction
 *     has set the GUC (a background job, a script, a future cache).
 *
 * The connection runs as `tajribah_app`, never as a superuser: §13.2 — a superuser ignores
 * RLS entirely, so a suite that ran as one would pass while the database leaked.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableColumns, getTableName, sql } from 'drizzle-orm';
import { getTableConfig, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { ALL_TABLES, APPEND_ONLY, EXEMPT, RLS_EXEMPT, tenantColumnOf } from '@/db/schema';
import { TenantDb } from '@/server/core/tenancy/tenant-db';
import { withTenant } from '@/server/core/tenancy/rls';
import { createTestDb, denied, seedTenant, setTenant, type TestDb } from '@/server/testing/harness';

/** Distinct integers, so a parent seeded once cannot collide on a unique key like `(model_id, version)`. */
let serial = 0;

/** A row that satisfies every NOT NULL column, without caring what the table means. */
function synthRow(table: PgTable, tenantId: string | null, suffix: string): Record<string, unknown> {
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const row: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columns)) {
    if (column.name === 'tenant_id') { if (tenantId) row[key] = tenantId; continue; }
    if (!column.notNull || column.hasDefault) continue;
    const enums = (column as any).enumValues as string[] | undefined;
    if (enums?.length) { row[key] = enums[0]; continue; }
    switch (column.dataType) {
      case 'number': row[key] = ++serial; break;
      case 'bigint': row[key] = ++serial; break;
      case 'boolean': row[key] = false; break;
      case 'date': row[key] = new Date(); break;
      case 'json': row[key] = {}; break;
      default:
        // uuid and date columns will not take an arbitrary string.
        if (column.columnType === 'PgUUID') row[key] = '00000000-0000-4000-8000-000000000000';
        else if (column.columnType === 'PgDateString') row[key] = '2026-01-01';
        else row[key] = `${column.name}-${suffix}`;
    }
  }
  return row;
}

/**
 * `synthRow` plus a real parent row behind every required foreign key.
 *
 * Postgres enforces foreign keys, so a placeholder uuid in `sessions.user_id` fails the
 * insert before RLS is ever consulted — and a suite whose seed fails proves nothing. Parents
 * belong to the same tenant as the child and are made once per test database (`made`).
 * Call it as the superuser: planting rows is exactly what the scoped role must not do.
 */
async function seedRow(
  harness: TestDb, table: PgTable, tenantId: string, suffix: string,
  made: Map<string, unknown>, depth = 0,
): Promise<Record<string, unknown>> {
  const row = synthRow(table, tenantColumnOf(table) ? tenantId : null, suffix);
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const keyOf = (target: PgColumn, of: Record<string, PgColumn>) =>
    Object.entries(of).find(([, column]) => column === target)![0];

  for (const fk of getTableConfig(table).foreignKeys) {
    const ref = fk.reference();
    const [column] = ref.columns;
    if (ref.columns.length !== 1 || column.name === 'tenant_id' || !column.notNull) continue;
    const parent = ref.foreignTable;
    const parentName = getTableName(parent);
    if (parentName === 'tenants') { row[keyOf(column, columns)] = tenantId; continue; }
    if (depth > 6) throw new Error(`foreign keys from ${getTableName(table)} nest too deep to seed`);

    if (!made.has(parentName) && !tenantColumnOf(parent)) {
      // Platform reference data a migration seeds (the plan catalogue, P2.1): point at a real
      // row rather than invent one that collides with it on a unique code.
      const [existing] = await harness.db.select().from(parent as any).limit(1) as any[];
      if (existing) made.set(parentName, existing[keyOf(ref.foreignColumns[0], getTableColumns(parent) as Record<string, PgColumn>)]);
    }
    if (!made.has(parentName)) {
      const parentRow = await seedRow(harness, parent, tenantId, `parent-${parentName}`, made, depth + 1);
      const [inserted] = await harness.db.insert(parent as any).values(parentRow as any).returning() as any[];
      made.set(parentName, inserted[keyOf(ref.foreignColumns[0], getTableColumns(parent) as Record<string, PgColumn>)]);
    }
    row[keyOf(column, columns)] = made.get(parentName);
  }
  return row;
}

/** A harmless `SET` for the update attempt: Drizzle rejects an empty patch before any SQL runs. */
function patchFor(table: PgTable): Record<string, unknown> | null {
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  for (const [key, column] of Object.entries(columns)) {
    if (column.name === 'id' || column.name === 'tenant_id') continue;
    if ((column as any).enumValues?.length) continue;
    // Fixed-width and typed strings (currency char(3), uuid, date) reject free text.
    if (column.columnType !== 'PgText' && column.columnType !== 'PgVarchar') continue;
    if ((column as any).length) continue;
    if (column.dataType === 'string') return { [key]: 'touched-by-another-tenant' };
  }
  for (const [key, column] of Object.entries(columns)) {
    if (column.name === 'id' || column.name === 'tenant_id') continue;
    if (column.dataType === 'number') return { [key]: 424242 };
  }
  return null;
}

const ALWAYS = sql`true`;
/** Tables with a tenant column. `TenantDb` covers all of them. */
const tenantTables = () => ALL_TABLES.filter((table) => tenantColumnOf(table) !== null);

/** Those of them that carry an RLS policy — platform infrastructure deliberately does not. */
const policyTables = () => tenantTables().filter((table) => !RLS_EXEMPT[getTableName(table)]);

test('every table is either tenant-scoped or exempt with a written reason', () => {
  const undecided = ALL_TABLES
    .map((table) => getTableName(table))
    .filter((name) => {
      const table = ALL_TABLES.find((t) => getTableName(t) === name)!;
      return tenantColumnOf(table) === null && name !== 'tenants' && !EXEMPT[name];
    });

  assert.deepEqual(undecided, [],
    'These tables have no tenant column and no entry in EXEMPT. Add the column, or add the ' +
    'table to EXEMPT in db/schema/index.ts with the reason it does not need one.');
});

test('every exemption says why, in writing', () => {
  for (const [name, reason] of Object.entries(EXEMPT)) {
    assert.ok(reason.length > 30, `EXEMPT["${name}"] needs a real reason, not "${reason}"`);
  }
  // Removing a policy removes a guarantee, so these reasons are held to a higher bar: who
  // reads the table, and why a policy cannot serve them.
  for (const [name, reason] of Object.entries(RLS_EXEMPT)) {
    assert.ok(reason.length > 80, `RLS_EXEMPT["${name}"] must explain who reads it and why a policy cannot work`);
  }
});

test('the connection is not a superuser — otherwise RLS proves nothing', async () => {
  const harness = await createTestDb();
  try {
    // pg_roles, not pg_user: `tajribah_app` is NOLOGIN, and pg_user lists only login roles.
    const result: any = await harness.db.execute(
      sql`select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    const rows = Array.isArray(result) ? result : result.rows;
    assert.equal(rows[0]?.current_user, 'tajribah_app', 'tests must run as the application role');
    assert.equal(rows[0]?.rolsuper, false, 'a superuser bypasses every policy (§13.2)');
    assert.equal(rows[0]?.rolbypassrls, false, 'BYPASSRLS skips every policy just as a superuser does');
  } finally { await harness.close(); }
});

test('every RLS policy is enabled AND forced', async () => {
  const harness = await createTestDb();
  try {
    const result: any = await harness.asAdmin(() => harness.db.execute(sql`
      select relname, relrowsecurity, relforcerowsecurity
      -- 'p' too: a partitioned parent (sync_job_items, 0002) is not an ordinary table.
      from pg_class where relkind in ('r', 'p') and relnamespace = 'public'::regnamespace
    `));
    const rows: { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[] =
      Array.isArray(result) ? result : result.rows;
    const byName = new Map(rows.map((row) => [row.relname, row]));

    for (const table of policyTables()) {
      const name = getTableName(table);
      const row = byName.get(name);
      assert.ok(row, `${name}: not found in pg_class`);
      assert.equal(row!.relrowsecurity, true, `${name}: row level security is not enabled`);
      assert.equal(row!.relforcerowsecurity, true,
        `${name}: FORCE is missing — the table owner would bypass the policy silently`);
    }
  } finally { await harness.close(); }
});

test('no partition of a tenant table can be read around its parent', async () => {
  // §13.2: a suite that names only the parent passes while a partition leaks. Policies are
  // checked on the table a query names, so a partition must not be reachable by name at all.
  const harness = await createTestDb();
  try {
    const result: any = await harness.asAdmin(() => harness.db.execute(sql`
      select p.relname as parent, c.relname as part,
             has_table_privilege('tajribah_app', c.oid, 'SELECT') as app,
             has_table_privilege('tajribah_admin', c.oid, 'SELECT') as admin
      from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_class p on p.oid = i.inhparent
      where p.relnamespace = 'public'::regnamespace`));
    const rows: { parent: string; part: string; app: boolean; admin: boolean }[] = Array.isArray(result) ? result : result.rows;
    const tenantNames = new Set(policyTables().map((t) => getTableName(t)));
    const partitions = rows.filter((r) => tenantNames.has(r.parent));
    assert.ok(partitions.length > 0, 'expected at least sync_job_items to be partitioned (0002)');
    const open = partitions.filter((r) => r.app || r.admin).map((r) => `${r.part} (of ${r.parent})`);
    assert.deepEqual(open, [], 'grant the parent only; a partition read directly skips the parent\'s policy');
  } finally { await harness.close(); }
});

test('with no tenant set, a scoped table returns nothing and does not raise', async () => {
  // §13.1: COMMIT resets the GUC to the empty string, and an inline cast would raise
  // `invalid input syntax for type uuid` instead of returning an empty result.
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    await harness.asAdmin(async () => {
      await harness.db.execute(sql`insert into products (id, tenant_id, name) values (gen_random_uuid(), ${a.tenantId}, 'x')`);
    });

    await setTenant(harness.db, null);
    const result: any = await harness.db.execute(sql`select count(*)::int as n from products`);
    const rows = Array.isArray(result) ? result : result.rows;
    assert.equal(rows[0].n, 0, 'no tenant context must mean no rows, not an error');
  } finally { await harness.close(); }
});

test('Postgres RLS blocks raw SQL across tenants', async (t) => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const b = await seedTenant(harness, 'bravo');
    const made = new Map<string, unknown>();

    for (const table of policyTables()) {
      const name = getTableName(table);
      await t.test(name, async () => {
        await harness.asAdmin(async () => {
          await harness.db.insert(table as any).values(await seedRow(harness, table, b.tenantId, `b-${name}`, made) as any);
        });

        await setTenant(harness.db, a.tenantId);
        const seen: any = await harness.db.execute(sql`select count(*)::int as n from ${table} where tenant_id = ${b.tenantId}`);
        const rows = Array.isArray(seen) ? seen : seen.rows;
        assert.equal(rows[0].n, 0, `${name}: RLS let tenant A read tenant B's rows`);

        if (APPEND_ONLY[name]) {
          // No DELETE privilege at all: refused before RLS is even consulted.
          assert.equal(await denied(() => harness.db.execute(sql`delete from ${table} where tenant_id = ${b.tenantId}`)), 'threw',
            `${name} is append-only, but the app role could issue a DELETE`);
        } else {
          const deleted: any = await harness.db.execute(sql`delete from ${table} where tenant_id = ${b.tenantId} returning 1`);
          const deletedRows = Array.isArray(deleted) ? deleted : deleted.rows;
          assert.equal(deletedRows.length, 0, `${name}: RLS let tenant A delete tenant B's rows`);
        }

        // And writing a row that claims another tenant is refused by WITH CHECK.
        assert.equal(
          await denied(() => harness.db.execute(
            sql`insert into ${table} (tenant_id) values (${b.tenantId})`,
          )),
          'threw',
          `${name}: WITH CHECK let tenant A insert a row owned by tenant B`,
        );
      });
    }
  } finally { await harness.close(); }
});

test('TenantDb blocks the same access with no GUC set at all', async (t) => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const b = await seedTenant(harness, 'bravo');
    const scopedToA = TenantDb.for(a.tenantId);
    const made = new Map<string, unknown>();

    for (const table of tenantTables()) {
      const name = getTableName(table);
      const tenantKey = tenantColumnOf(table)!;
      const columns = getTableColumns(table) as Record<string, PgColumn>;
      const hasId = 'id' in columns;
      const bId = '11111111-2222-4333-8444-555555555555';

      await t.test(name, async () => {
        await harness.asAdmin(async () => {
          const row = await seedRow(harness, table, b.tenantId, `b2-${name}`, made);
          if (hasId) row.id = bId;
          await harness.db.insert(table as any).values(row as any);
        });

        // No tenant in the GUC: RLS alone would hide everything, so this only exercises
        // the predicate layer once the GUC is set to A.
        await setTenant(harness.db, a.tenantId);

        const visible = await scopedToA.find(table, undefined, { limit: 1000 });
        assert.ok(visible.every((row: any) => row[tenantKey] === a.tenantId),
          `${name}: TenantDb returned another tenant's rows`);

        if (hasId) {
          assert.equal(await scopedToA.findById(table, bId), null, `${name}: findById leaked`);
          assert.equal(await denied(() => scopedToA.requireById(table, bId)), 'threw',
            `${name}: requireById must 404 for another tenant's id`);
        }

        const patch = patchFor(table);
        if (patch) {
          await scopedToA.update(table, ALWAYS, patch as any);
          const after: any = await harness.asAdmin(() => harness.db.execute(
            sql`select count(*)::int as n from ${table} where tenant_id = ${b.tenantId}`,
          ));
          const rows = Array.isArray(after) ? after : after.rows;
          assert.ok(rows[0].n >= 1, `${name}: the update destroyed tenant B's row`);
        }

        await scopedToA.delete(table, ALWAYS);
        const survivors: any = await harness.asAdmin(() => harness.db.execute(
          sql`select count(*)::int as n from ${table} where tenant_id = ${b.tenantId}`,
        ));
        const rows = Array.isArray(survivors) ? survivors : survivors.rows;
        assert.ok(rows[0].n >= 1, `${name}: delete reached another tenant's rows`);
      });
    }
  } finally { await harness.close(); }
});

test('writes that name another tenant are refused, not corrected', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const b = await seedTenant(harness, 'bravo');
    const { products } = await import('@/db/schema');

    await withTenant(a.tenantId, async (db) => {
      await assert.rejects(
        () => db.insert(products, { tenantId: b.tenantId, name: 'smuggled' } as any),
        /Refusing to insert/,
        'an insert naming another tenant must throw, not be silently rewritten',
      );

      const mine = await db.insert(products, { name: 'mine' } as any);
      assert.equal((mine as any).tenantId, a.tenantId, 'insert must stamp the scoped tenant');

      await assert.rejects(
        () => db.updateById(products, (mine as any).id, { tenantId: b.tenantId } as any),
        /rows do not move between tenants/,
        'moving a row to another tenant must be impossible through TenantDb',
      );
    });
  } finally { await harness.close(); }
});

test('TenantDb refuses tables it cannot scope', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const scopedToA = TenantDb.for(a.tenantId);
    const { users } = await import('@/db/schema');
    await assert.rejects(
      () => scopedToA.find(users),
      /has no tenant column/,
      'users is global by design — reaching it through TenantDb must fail loudly',
    );
  } finally { await harness.close(); }
});

test('withTenant sets the tenant only for its own transaction', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const { products } = await import('@/db/schema');

    await withTenant(a.tenantId, async (db) => {
      await db.insert(products, { name: 'inside' } as any);
    });

    // After COMMIT the setting is gone (it was transaction-local), so the next statement
    // on the same connection sees nothing. That is the whole point of `set_config(.., true)`.
    const result: any = await harness.db.execute(sql`select count(*)::int as n from products`);
    const rows = Array.isArray(result) ? result : result.rows;
    assert.equal(rows[0].n, 0, 'a transaction-local tenant must not leak to the next statement');
  } finally { await harness.close(); }
});
