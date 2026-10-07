#!/usr/bin/env node
/**
 * GO-LIVE §3–§5 — deploy the dashboard + website Worker to tajribah.org, the day the Hetzner server exists.
 *
 *   node scripts/deploy/deploy-dashboard.mjs --check               what is still missing; changes nothing
 *   node scripts/deploy/deploy-dashboard.mjs --create-hyperdrive   once: the two Hyperdrive configs from the database logins
 *   node scripts/deploy/deploy-dashboard.mjs --dry-run             build and assemble; wrangler checks it without deploying
 *   node scripts/deploy/deploy-dashboard.mjs                       build, send the secrets, deploy
 *
 * Settings: `deploy/production.jsonc` (committed, nothing secret). Secrets: the git-ignored
 * `.env.production.local`. Before anything reaches Cloudflare the two together are checked by the
 * platform's own rules (`server/core/config/env.ts`, the same check the Worker runs at boot), so a deploy
 * never starts a Worker that would refuse to boot. No secret value is ever printed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NEEDED, PLACEHOLDER, assemble, hyperdriveArgs, parseJsonc, placeholdersIn, readEnvFile, secretsOf } from './config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const wrangler = (args, opts = {}) => spawnSync(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd: ROOT, encoding: 'utf8', ...opts });

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const has = (f) => process.argv.includes(f);
  const prodPath = path.join(ROOT, 'deploy/production.jsonc');
  const production = parseJsonc(fs.readFileSync(prodPath, 'utf8'));
  const envPath = path.join(ROOT, '.env.production.local');
  const fileEnv = fs.existsSync(envPath) ? readEnvFile(fs.readFileSync(envPath, 'utf8')) : {};

  if (has('--create-hyperdrive')) {
    const raw = fs.readFileSync(prodPath, 'utf8');
    let next = raw;
    for (const [binding, name, url] of [['HYPERDRIVE_APP', 'tajribah-app', fileEnv.DATABASE_APP_URL], ['HYPERDRIVE_ADMIN', 'tajribah-admin', fileEnv.DATABASE_ADMIN_URL]]) {
      if (!placeholdersIn(production).includes(binding)) { console.log(`${binding}: already set`); continue; }
      if (!url) { console.error(`${binding}: add ${binding === 'HYPERDRIVE_APP' ? 'DATABASE_APP_URL' : 'DATABASE_ADMIN_URL'} to .env.production.local first`); process.exit(1); }
      const r = wrangler(hyperdriveArgs(name, url, { id: fileEnv.HYPERDRIVE_ACCESS_CLIENT_ID, secret: fileEnv.HYPERDRIVE_ACCESS_CLIENT_SECRET }));
      const id = /"id":\s*"([0-9a-f]{32})"|\bid[:=]\s*"?([0-9a-f]{32})/.exec(r.stdout ?? '');
      const why = `${r.stderr ?? ''}\n${r.stdout ?? ''}`.split('\n').find((l) => /error|fail/i.test(l))?.replace(/(password|secret)=\S+/gi, '$1=…');
      if (r.status !== 0 || !id) { console.error(`${binding}: wrangler could not create it (exit ${r.status}) — ${why ?? 'see the dashboard'}`); process.exit(1); }
      next = next.replace(new RegExp(`("binding": "${binding}", "id": ")${PLACEHOLDER}(")`), `$1${id[1] ?? id[2]}$2`);
      console.log(`✓ ${binding} → Hyperdrive ${name}`);
    }
    fs.writeFileSync(prodPath, next);
    process.exit(0);
  }

  // Everything missing, at once.
  const problems = [];
  if (!fs.existsSync(envPath)) problems.push('.env.production.local does not exist');
  for (const [name, why] of Object.entries(NEEDED)) if (!fileEnv[name]) problems.push(`.env.production.local: ${name} — ${why}`);
  for (const binding of placeholdersIn(production)) problems.push(`deploy/production.jsonc: ${binding} has no Hyperdrive id — run with --create-hyperdrive once the database logins are in .env.production.local`);
  const { loadEnv } = await import(pathToFileURL(path.join(ROOT, 'server/core/config/env.ts')).href);
  try { loadEnv({ ...production.vars, ...secretsOf(fileEnv, production.vars) }); } catch (e) {
    // "  NAME: why" lines; a name already listed above is not repeated.
    for (const [, name, why] of String(e.message).matchAll(/^\s+([A-Z0-9_]+|\(root\)): (.+)$/gm)) {
      if (!problems.some((p) => p.includes(`: ${name} `))) problems.push(`the Worker would refuse to boot: ${name} — ${why}`);
    }
  }
  if (problems.length) { console.error(`Not ready to deploy (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`); process.exit(1); }
  console.log('✓ settings and secrets pass the boot check');
  if (has('--check')) process.exit(0);

  const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);
  const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/server/wrangler.json'), 'utf8'));
  const config = path.join(ROOT, 'dist/server/wrangler.production.json');
  fs.writeFileSync(config, JSON.stringify(assemble(built, production), null, 2));
  console.log(`✓ assembled ${path.relative(ROOT, config)}`);

  if (has('--dry-run')) { const r = wrangler(['deploy', '--config', config, '--dry-run'], { stdio: 'inherit' }); process.exit(r.status ?? 1); }

  // Secrets go through stdin as JSON — never on a command line, never printed.
  const secrets = secretsOf(fileEnv, production.vars);
  const sent = wrangler(['secret', 'bulk', '--config', config], { input: JSON.stringify(secrets), stdio: ['pipe', 'ignore', 'inherit'] });
  if (sent.status !== 0) { console.error('the secrets were not sent'); process.exit(1); }
  console.log(`✓ ${Object.keys(secrets).length} secrets sent: ${Object.keys(secrets).sort().join(', ')}`);
  const deployed = wrangler(['deploy', '--config', config], { stdio: 'inherit' });
  if (deployed.status !== 0) process.exit(deployed.status ?? 1);
  console.log('Deployed. Check: https://tajribah.org/api/health/ready → 200 with "database": "ok" (GO-LIVE §3).');
}
