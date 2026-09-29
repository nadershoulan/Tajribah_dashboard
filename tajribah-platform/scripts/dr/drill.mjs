#!/usr/bin/env node
/**
 * P7 — disaster recovery: back up, and prove a backup restores whole (the plan's "backup verify"
 * and the P7 gate's restore drill). Only the standard Postgres tools (`pg_dump`, `pg_restore`,
 * `psql`, `createdb`, `dropdb`), so it works whatever host is chosen (DECISIONS T9).
 *
 *   node scripts/dr/drill.mjs backup --db <url> --out <dir>
 *       → <dir>/tajribah-<time>.dump and .manifest.json (sha256, schema fingerprint, policies,
 *         per table: rows, RLS on, RLS forced)
 *   node scripts/dr/drill.mjs verify --dump <file> --server <url of a maintenance db> [--keep]
 *       → restores into a new scratch database on that server, checks it against the manifest
 *         (`compare.mjs`) and probes isolation as the application role; prints a report with
 *         how long the restore took (the recovery time to write down); exit 1 on any problem.
 *   --after-restore "<sql>"   (verify, drills only) run SQL on the restored copy before the checks —
 *                             how a drill proves the checks fail when the restore is not whole.
 *
 * `PG_BIN` points at the Postgres binaries when they are not on PATH.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { compareRestore } from './compare.mjs';

const BIN = process.env.PG_BIN ?? '';
const tool = (name) => (BIN ? path.join(BIN, name) : name);

function run(name, args, input) {
  // UTF-8 always: the stores' Arabic names must not pass through a Windows code page.
  const res = spawnSync(tool(name), args, { encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, PGCLIENTENCODING: 'UTF8' } });
  if (res.status !== 0) throw new Error(`${name} failed (${res.status}): ${(res.stderr || res.stdout || String(res.error)).trim().slice(0, 2000)}`);
  return res.stdout;
}
const psql = (db, sql) => run('psql', ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql]).trim();

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const key = argv[i].slice(2); out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } else out._.push(argv[i]);
  }
  return out;
}

/** What a database holds: the facts a manifest records and a restore is checked against. */
function facts(db) {
  const schema = createHash('sha256').update(psql(db, `
    select coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' order by table_name, ordinal_position), '')
      from information_schema.columns where table_schema = 'public'`)).digest('hex');
  const policies = Number(psql(db, `select count(*) from pg_policies where schemaname = 'public'`));
  const tables = {};
  const rows = psql(db, `
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`);
  for (const line of rows.split(/\r?\n/).filter(Boolean)) {
    const [name, rls, forced] = line.split('|');
    tables[name] = { rows: Number(psql(db, `select count(*) from only "${name}"`)), rls: rls === 't', forced: forced === 't' };
  }
  return { schema, policies, tables };
}

/** Swap the database name in a connection URL. */
const withDb = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };

function backup(opts) {
  if (!opts.db || !opts.out) throw new Error('backup needs --db <url> --out <dir>');
  fs.mkdirSync(opts.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(opts.out, `tajribah-${stamp}.dump`);
  const started = Date.now();
  run('pg_dump', ['-Fc', '--no-password', '-d', opts.db, '-f', file]);
  const manifest = {
    createdAt: new Date().toISOString(), seconds: (Date.now() - started) / 1000,
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    bytes: fs.statSync(file).size, ...facts(opts.db),
  };
  fs.writeFileSync(`${file.replace(/\.dump$/, '')}.manifest.json`, JSON.stringify(manifest, null, 2));
  return { file, manifest };
}

function verify(opts) {
  if (!opts.dump || !opts.server) throw new Error('verify needs --dump <file> --server <url>');
  const manifest = JSON.parse(fs.readFileSync(opts.dump.replace(/\.dump$/, '.manifest.json'), 'utf8'));
  const problems = [];
  const sha = createHash('sha256').update(fs.readFileSync(opts.dump)).digest('hex');
  if (sha !== manifest.sha256) return { ok: false, problems: ['the dump is not the file the manifest describes (sha256 differs)'] };

  const scratch = `tajribah_verify_${Date.now()}`;
  const target = withDb(opts.server, scratch);
  // Roles live in the cluster, not the dump: a fresh server needs them before the grants restore.
  psql(opts.server, `do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'tajribah_app') then create role tajribah_app nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'tajribah_admin') then create role tajribah_admin nologin bypassrls; end if;
  end $$`);
  psql(opts.server, `create database "${scratch}"`);
  const started = Date.now();
  let report;
  try {
    run('pg_restore', ['--exit-on-error', '--no-password', '-d', target, opts.dump]);
    const seconds = (Date.now() - started) / 1000;
    if (typeof opts['after-restore'] === 'string') psql(target, opts['after-restore']);
    const restored = facts(target);
    // Isolation, as the application role: one store's context reads its own products, none of another's.
    const [a, b] = psql(target, `select tenant_id from products group by tenant_id order by count(*) desc limit 2`).split(/\r?\n/).filter(Boolean);
    restored.ownRows = 0; restored.crossTenantRows = 0;
    if (a && b) {
      const probe = (tenant, other) => Number(psql(target, `begin; set local role tajribah_app; select set_config('app.tenant_id', '${tenant}', true); select count(*) from products where tenant_id = '${other}'; commit;`).split(/\r?\n/).filter(Boolean).at(-1));
      restored.ownRows = probe(a, a);
      restored.crossTenantRows = probe(a, b) + probe(b, a);
    }
    const compared = compareRestore(manifest, restored);
    report = { ok: compared.ok, problems: [...problems, ...compared.problems], restoreSeconds: seconds, tables: Object.keys(restored.tables).length, rows: Object.values(restored.tables).reduce((n, t) => n + t.rows, 0), scratch };
  } finally {
    if (!opts.keep) psql(opts.server, `drop database if exists "${scratch}" with (force)`);
  }
  return report;
}

const opts = args(process.argv.slice(2));
const command = opts._[0];
try {
  if (command === 'backup') {
    const { file, manifest } = backup(opts);
    console.log(JSON.stringify({ file, tables: Object.keys(manifest.tables).length, bytes: manifest.bytes, seconds: manifest.seconds }, null, 2));
  } else if (command === 'verify') {
    const report = verify(opts);
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  } else {
    console.error('usage: drill.mjs backup --db <url> --out <dir> | verify --dump <file> --server <url> [--keep] [--after-restore "<sql>"]');
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
