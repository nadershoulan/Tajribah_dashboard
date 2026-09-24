/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P1.6b — `sync_job_items` is partitioned by month (0002), and partitioning did not open a
 * way around row-level security (§13.2: "isolation checks that name only the parent table
 * will pass while a partition leaks").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { unsafeAdminDb } from '@/db/client';
import { syncJobItems, syncJobs, storeConnections } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { withTenant } from '@/server/core/tenancy/rls';
import { createTestDb, migrationStatements, rollbackStatements, seedTenant, type TestDb } from '@/server/testing/harness';
import { ensureSyncItemPartitions } from '@/server/modules/sync/schedule';

const rows = (result: any): any[] => result.rows ?? result;
/** Drizzle wraps the driver's error; the Postgres message is on `cause`. */
const denied = (e: any) => /permission denied/i.test(`${e?.message} ${e?.cause?.message ?? ''}`);
const monthName = (d: Date) => `sync_job_items_y${d.getUTCFullYear()}m${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

async function oneSyncJob(harness: TestDb, tenantId: string): Promise<string> {
  const connectionId = uuidv7();
  const syncJobId = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(storeConnections).values({ id: connectionId, tenantId, provider: 'salla', externalStoreId: `s-${tenantId}` } as any);
    await harness.db.insert(syncJobs).values({ id: syncJobId, tenantId, connectionId, type: 'full' } as any);
  });
  return syncJobId;
}

test('partitioned by month, with this month and the next two ready and a DEFAULT behind them', async () => {
  const harness = await createTestDb();
  try {
    const parts = rows(await harness.asAdmin(() => harness.db.execute(sql`
      select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
      where i.inhparent = 'sync_job_items'::regclass order by 1`))).map((r) => r.name);
    const now = new Date();
    for (let i = 0; i < 3; i++) assert.ok(parts.includes(monthName(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)))), parts.join(', '));
    assert.ok(parts.includes('sync_job_items_default'));
    assert.equal(rows(await harness.asAdmin(() => harness.db.execute(sql`select count(*)::int as n from pg_partitioned_table where partrelid = 'sync_job_items'::regclass`)))[0].n, 1);

    const later = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 5, 15));
    const made = await ensureSyncItemPartitions(later);
    assert.equal(made[0], monthName(later));
    assert.deepEqual(await ensureSyncItemPartitions(later), made, 'idempotent');
    await assert.rejects(() => harness.db.execute(sql`select ensure_sync_job_items_partition(now()::date)`), denied, 'the app role cannot run DDL');
  } finally { await harness.close(); }
});

test('rows land in their month; RLS on the parent matches the generator; partitions cannot be read directly', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const b = await seedTenant(harness, 'beta');
    const jobA = await oneSyncJob(harness, a.tenantId);
    const jobB = await oneSyncJob(harness, b.tenantId);
    await withTenant(a.tenantId, (db) => db.insert(syncJobItems, { id: uuidv7(), tenantId: a.tenantId, syncJobId: jobA, externalId: 'x', action: 'created' }));
    await withTenant(b.tenantId, (db) => db.insert(syncJobItems, { id: uuidv7(), tenantId: b.tenantId, syncJobId: jobB, externalId: 'y', action: 'created' }));

    const where = rows(await harness.asAdmin(() => harness.db.execute(sql`select tableoid::regclass::text as part from sync_job_items`)));
    assert.deepEqual([...new Set(where.map((r) => r.part))], [monthName(new Date())], 'not the DEFAULT partition');

    const seen = await withTenant(a.tenantId, (db) => db.find(syncJobItems));
    assert.deepEqual(seen.map((r) => r.externalId), ['x'], 'the parent is tenant-scoped');

    const policy = (table: string) => harness.asAdmin(() => harness.db.execute(sql`
      select qual, with_check from pg_policies where tablename = ${table}`)).then((r) => rows(r)[0]);
    assert.deepEqual(await policy('sync_job_items'), await policy('sync_jobs'), 'the same policy 0001 generates for every tenant table');
    const forced = rows(await harness.asAdmin(() => harness.db.execute(sql`select relforcerowsecurity as f from pg_class where relname = 'sync_job_items'`)))[0].f;
    assert.equal(forced, true);

    const partition = sql.raw(`"${monthName(new Date())}"`);
    await assert.rejects(() => harness.db.execute(sql`select * from ${partition}`), denied, 'app role: through the parent only');
    await assert.rejects(() => unsafeAdminDb().execute(sql`select * from ${partition}`), denied, 'admin role too');
    await assert.rejects(() => harness.db.execute(sql`select * from sync_job_items_default`), denied);
  } finally { await harness.close(); }
});

test('rolling back 0002 alone gives the flat table back, rows, policy and grants included', async () => {
  const client = await PGlite.create();
  try {
    for (const statement of migrationStatements()) await client.exec(statement);
    const tenant = uuidv7();
    await client.exec(`insert into tenants (id, slug, name) values ('${tenant}', 'r', 'R')`);
    const conn = uuidv7(); const job = uuidv7();
    await client.exec(`insert into store_connections (id, tenant_id, provider, external_store_id) values ('${conn}', '${tenant}', 'salla', 's')`);
    await client.exec(`insert into sync_jobs (id, tenant_id, connection_id, type) values ('${job}', '${tenant}', '${conn}', 'full')`);
    await client.exec(`insert into sync_job_items (id, tenant_id, sync_job_id, external_id, action) values ('${uuidv7()}', '${tenant}', '${job}', 'kept', 'created')`);

    const own = rollbackStatements().find((r) => r.file.startsWith('0002'))!;
    for (const statement of own.statements) await client.exec(statement);

    const q = async (text: string) => (await client.query<any>(text)).rows;
    assert.equal((await q(`select count(*)::int as n from pg_partitioned_table`))[0].n, 0);
    assert.deepEqual((await q(`select external_id from sync_job_items`)).map((r) => r.external_id), ['kept']);
    assert.equal((await q(`select count(*)::int as n from pg_policies where tablename = 'sync_job_items'`))[0].n, 1);
    assert.equal((await q(`select count(*)::int as n from information_schema.role_table_grants where table_name = 'sync_job_items' and grantee in ('tajribah_app', 'tajribah_admin') and privilege_type = 'SELECT'`))[0].n, 2);
    assert.equal((await q(`select count(*)::int as n from pg_proc where proname = 'ensure_sync_job_items_partition'`))[0].n, 0);
  } finally { await client.close(); }
});
