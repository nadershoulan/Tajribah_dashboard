#!/usr/bin/env node
/**
 * P0.20 / P7 — the update runner for the database: applies `drizzle/NNNN_*.sql` in order, each once.
 *
 *   node scripts/db/migrate.mjs --db "postgresql://owner@host:5432/tajribah"    apply what is new
 *   node scripts/db/migrate.mjs --db … --status                                 list, change nothing
 *
 * Standard Postgres tools only (`psql`), like the backup drill (`scripts/dr/`), so it works whatever
 * host is chosen. Run it as the database owner — the login that owns the tables — never as the app's
 * or the admin role's login.
 *
 *  - **A ledger** (`schema_migrations`: tag, sha-256 of the file, when) says what is applied. A file
 *    already applied whose bytes have changed stops the run: migrations are history, not drafts.
 *  - **Each file runs with ON_ERROR_STOP**, outside a transaction (a `CREATE INDEX CONCURRENTLY`
 *    cannot run inside one). Every migration is expand-only (the migration-safety test holds them to
 *    it), so the version still running keeps working while it applies. A file that fails part way
 *    stops the run and is not recorded: read the error, finish or undo by hand (each file's
 *    `-- ROLLBACK:` block), then run again.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'drizzle');
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const db = arg('--db');
if (!db) { console.error('usage: node scripts/db/migrate.mjs --db <connection> [--status]'); process.exit(2); }
const env = { ...process.env, PGCLIENTENCODING: 'UTF8', PGOPTIONS: '-c client_min_messages=warning' }; // Arabic text in the migrations; no chatter

const psql = (args, input) => execFileSync(arg('--psql') ?? 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args], { env, encoding: 'utf8', input });
const query = (text) => psql(['-A', '-t', '-c', text]).split(/\r?\n/).filter(Boolean);

psql(['-c', 'create table if not exists schema_migrations (tag text primary key, sha256 text not null, applied_at timestamptz not null default now())']);
const applied = new Map(query('select tag, sha256 from schema_migrations').map((line) => line.split('|')));
const files = fs.readdirSync(DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

let pending = 0;
for (const file of files) {
  const tag = file.replace(/\.sql$/, '');
  const text = fs.readFileSync(path.join(DIR, file));
  const sha = createHash('sha256').update(text).digest('hex');
  const done = applied.get(tag);
  if (done && done !== sha) {
    console.error(`${tag}: applied, but the file has changed since (${done.slice(0, 12)} → ${sha.slice(0, 12)}). Migrations are history — add a new one.`);
    process.exit(1);
  }
  if (done) { if (process.argv.includes('--status')) console.log(`applied  ${tag}`); continue; }
  pending++;
  if (process.argv.includes('--status')) { console.log(`pending  ${tag}`); continue; }
  const started = Date.now();
  try {
    psql(['-f', path.join(DIR, file)]);
  } catch (error) {
    console.error(`${tag}: failed — nothing after it was applied, and it is not recorded.\n${error.stderr ?? error.message}`);
    process.exit(1);
  }
  psql(['-c', `insert into schema_migrations (tag, sha256) values ('${tag}', '${sha}')`]);
  console.log(`applied  ${tag}  (${Date.now() - started} ms)`);
}
console.log(pending ? (process.argv.includes('--status') ? `${pending} pending` : `${pending} applied`) : 'up to date');
