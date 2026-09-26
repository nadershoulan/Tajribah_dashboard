/**
 * Every automated gate check, in one command, stopping at the first failure.
 *
 *   node scripts/verify.mjs --modules <node_modules dir> [--tsconfig <file>]
 *
 * 1. typecheck
 * 2. the full test suite (isolation, migrations + rollback, audit, storage, …)
 * 3. `.env.example` matches the env registry
 * 4. `drizzle/0001_rls.sql` matches what the schema generates
 * 5. ESLint — errors fail the gate; skipped, and said so, when ESLint is not installed
 *
 * `--modules` is the project's own node_modules (Node ≥ 22.13 + pnpm), or the scratch
 * toolkit described in CLAUDE.md. `--tsconfig` defaults to tsconfig.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const MODULES = resolve(arg('--modules', join(ROOT, 'node_modules')));
const TSCONFIG = resolve(arg('--tsconfig', join(ROOT, 'tsconfig.json')));

function step(name, args) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  const run = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (run.status !== 0) {
    console.error(`\n✗ ${name} failed (exit ${run.status}). Gate checks stop here.`);
    process.exit(run.status ?? 1);
  }
  console.log(`✓ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

step('typecheck', [join(MODULES, 'typescript/bin/tsc'), '-p', TSCONFIG, '--noEmit']);
step('tests', [join(ROOT, 'scripts/test.mjs'), '--modules', MODULES]);
step('.env.example is current', [join(ROOT, 'scripts/gen-env-example.mjs'), '--modules', MODULES, '--check']);

// The RLS generator has no --check mode; regenerate and compare, restoring on a mismatch.
// Every migration, not only 0001: a table created later carries its own generated block (P2.12).
const migrationDir = join(ROOT, 'drizzle');
const migrationFiles = readdirSync(migrationDir).filter((f) => f.endsWith('.sql'));
const before = new Map(migrationFiles.map((f) => [f, readFileSync(join(migrationDir, f))]));
step('regenerate RLS migration', [join(ROOT, 'scripts/gen-rls.mjs'), '--modules', MODULES]);
const drifted = migrationFiles.filter((f) => !readFileSync(join(migrationDir, f)).equals(before.get(f)));
if (drifted.length) {
  for (const f of drifted) writeFileSync(join(migrationDir, f), before.get(f));
  console.error(`\n✗ ${drifted.join(', ')}: not what the schema generates — run scripts/gen-rls.mjs and commit the result.`);
  process.exit(1);
}
console.log('✓ RLS migration matches the schema');

const eslint = join(MODULES, 'eslint/bin/eslint.js');
if (existsSync(eslint)) {
  step('lint', [eslint, '.', '--ignore-pattern', 'dist', '--ignore-pattern', '.next',
    '--ignore-pattern', 'dist-preview', '--ignore-pattern', '.sites-runtime', '--ignore-pattern', '.tests']);
} else {
  console.log('\n⚠ lint SKIPPED — no ESLint under --modules. This run does not cover lint.');
}
console.log('\nAll gate checks passed.');
