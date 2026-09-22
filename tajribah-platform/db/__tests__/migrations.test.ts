/**
 * P0.4 — "migration applied and reverted once locally", as a test that runs every time.
 *
 * §7.11: every migration ships a `-- ROLLBACK:` block. A rollback that has never been run
 * is a guess written under pressure-free conditions and discovered broken under pressure.
 * This applies every migration, runs every rollback newest-first, checks the database is
 * empty again, then applies everything a second time on the same database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrationStatements, rollbackStatements } from '@/server/testing/harness';

async function count(client: PGlite, sql: string): Promise<number> {
  const result = await client.query<{ n: number }>(sql);
  return Number(result.rows[0].n);
}

const TABLES = `select count(*)::int as n from pg_tables where schemaname = 'public'`;
const TYPES = `select count(*)::int as n from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e'`;
const POLICIES = `select count(*)::int as n from pg_policies where schemaname = 'public'`;
const ROLES = `select count(*)::int as n from pg_roles where rolname in ('tajribah_app', 'tajribah_admin')`;
const FUNCTION = `select count(*)::int as n from pg_proc where proname = 'current_tenant_id'`;

async function applyForward(client: PGlite) {
  for (const statement of migrationStatements()) await client.exec(statement);
}

async function applyRollback(client: PGlite) {
  for (const { file, statements } of rollbackStatements()) {
    assert.ok(statements.length > 0, `${file} has no executable rollback`);
    for (const statement of statements) {
      try { await client.exec(statement); } catch (error) {
        throw new Error(`${file} rollback failed at: ${statement}\n${String(error)}`);
      }
    }
  }
}

test('every migration applies, rolls back to an empty database, and applies again', async () => {
  const client = await PGlite.create();
  try {
    await applyForward(client);
    const tables = await count(client, TABLES);
    const types = await count(client, TYPES);
    const policies = await count(client, POLICIES);
    assert.ok(tables >= 50 && types > 0 && policies > 0, `forward created ${tables} tables, ${types} enums, ${policies} policies`);
    assert.equal(await count(client, ROLES), 2);

    await applyRollback(client);
    assert.equal(await count(client, TABLES), 0, 'tables left behind by the rollback');
    assert.equal(await count(client, TYPES), 0, 'enum types left behind by the rollback');
    assert.equal(await count(client, POLICIES), 0, 'policies left behind');
    assert.equal(await count(client, ROLES), 0, 'roles left behind — the next forward run would fail on CREATE ROLE');
    assert.equal(await count(client, FUNCTION), 0, 'current_tenant_id() left behind');

    await applyForward(client);
    assert.equal(await count(client, TABLES), tables, 'the second forward run rebuilds the same schema');
    assert.equal(await count(client, POLICIES), policies);
  } finally { await client.close(); }
});

test('each rollback names everything its migration creates', () => {
  const dir = join(process.cwd(), 'drizzle');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const [forward, rollback = ''] = readFileSync(join(dir, file), 'utf8').split('-- ROLLBACK:');
    // Drizzle schema-qualifies types (`"public"."actor_type"`); the rollback does not.
    const name = `(?:"?public"?\\.)?"?([a-z_0-9]+)"?`;
    const created = (kind: string) => [...forward.matchAll(new RegExp(`CREATE ${kind} (?:IF NOT EXISTS )?${name}`, 'gi'))].map((m) => m[1]);
    const dropped = (kind: string) => new Set([...rollback.matchAll(new RegExp(`DROP ${kind} IF EXISTS ${name}`, 'gi'))].map((m) => m[1]));
    for (const kind of ['TABLE', 'TYPE', 'ROLE', 'FUNCTION']) {
      const missing = created(kind).filter((name) => !dropped(kind).has(name));
      assert.deepEqual(missing, [], `${file}: CREATE ${kind} without a matching DROP in the rollback`);
    }
  }
});
