/**
 * GO-LIVE — the launch kit (`deploy/production.jsonc`, `scripts/deploy/*`): the production settings pass the
 * Worker's own boot check once the secrets exist, bind everything the Worker reads, keep secrets out of
 * the committed file, and the deploy script refuses while anything is missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, resetEnv, REGISTRY } from '../env';
import { NEEDED, PLACEHOLDER, UPLOADS, assemble, hyperdriveArgs, parseJsonc, placeholdersIn, readEnvFile, secretsOf } from '../../../../scripts/deploy/config.mjs';

const ROOT = process.cwd();
const production = parseJsonc(readFileSync(join(ROOT, 'deploy/production.jsonc'), 'utf8'));
/** Stand-ins for every value NEEDED names: what `.env.production.local` will hold on launch day. */
const filled = Object.fromEntries(Object.keys(NEEDED).map((k) => [k, k.startsWith('DATABASE') ? 'postgres://u:p@db.example:5432/tajribah' : 'x'.repeat(48)]));

test('the production settings pass the boot check once the needed secrets exist — and not without them', () => {
  resetEnv();
  const env = loadEnv({ ...production.vars, ...secretsOf(filled, production.vars) });
  assert.equal(env.NODE_ENV, 'production');
  resetEnv();
  for (const name of ['AUTH_SECRET', 'ENCRYPTION_KEY', 'SMTP_PASSWORD']) {
    const { [name]: _gone, ...rest } = filled;
    void _gone;
    assert.throws(() => loadEnv({ ...production.vars, ...secretsOf(rest, production.vars) }), new RegExp(name), `${name} is needed`);
    resetEnv();
  }
});

test('no secret in the committed file; every binding the Worker reads is bound', () => {
  for (const [name, entry] of Object.entries(REGISTRY)) {
    if ((entry as { secret?: boolean }).secret) assert.ok(!(name in production.vars), `${name} is a secret: .env.production.local, not deploy/production.jsonc`);
  }
  for (const name of Object.keys(NEEDED)) assert.ok(!(name in production.vars), `${name} comes from the env file`);
  const bound = [
    ...production.r2_buckets, ...production.kv_namespaces, ...production.hyperdrive, ...production.queues.producers,
  ].map((b: { binding: string }) => b.binding).sort();
  assert.deepEqual(bound, ['BUCKET', 'CONFIGS', 'HYPERDRIVE_ADMIN', 'HYPERDRIVE_APP', 'JOBS', 'PAIR_BUCKET', 'RATE_LIMITS']);
  assert.equal(production.r2_buckets.find((b: { binding: string }) => b.binding === 'BUCKET').bucket_name, production.vars.R2_BUCKET_NAME, 'presigned uploads go to the bound bucket');
  assert.deepEqual(production.d1_databases, [], 'the build’s placeholder D1 is not deployed');
  const hosts = production.routes.map((r: { pattern: string }) => r.pattern);
  for (const host of production.vars.SITE_HOSTS.split(',')) assert.ok(hosts.includes(host), `${host} reaches the Worker`);
  assert.ok(hosts.includes('ev.tajribah.org'), 'the visit collector');
});

test('the deploy refuses while a Hyperdrive id is a placeholder; the build’s local keys are dropped', () => {
  assert.deepEqual(placeholdersIn({ hyperdrive: [{ binding: 'A', id: PLACEHOLDER }, { binding: 'B', id: 'f'.repeat(32) }] }), ['A']);
  const merged = assemble({ name: 'tajribah-platform', main: 'index.js', dev: {}, topLevelName: 'x', legacy_env: true, r2_buckets: [{ binding: 'BUCKET', bucket_name: 'site-creator-r2' }] }, production);
  assert.equal(merged.name, 'tajribah');
  assert.equal(merged.main, 'index.js', 'the build’s entry stays');
  assert.equal(merged.r2_buckets[0].bucket_name, 'tajribah-files', 'production wins');
  assert.ok(!('dev' in merged) && !('topLevelName' in merged) && !('legacy_env' in merged));
});

test('secrets sent are the env file’s values minus plain vars and the database logins (Hyperdrive holds those)', () => {
  const sent = secretsOf({ AUTH_SECRET: 'a', R2_ACCOUNT_ID: 'id', DATABASE_APP_URL: 'pg', DATABASE_ADMIN_URL: 'pg', EMPTY: '' }, { R2_ACCOUNT_ID: 'id' });
  assert.deepEqual(sent, { AUTH_SECRET: 'a' });
});

test('the env file reader: a BOM, comments, quotes', () => {
  assert.deepEqual(readEnvFile('\uFEFFA=1\n# note\nB = "two words"\n C=\'3\'\r\nnot a line\n'), { A: '1', B: 'two words', C: '3' });
});

test('JSONC: comments go, a // inside a string stays, trailing commas allowed', () => {
  assert.deepEqual(parseJsonc('{\n // c\n "u": "https://x//y", // after\n "a": [1,2,],\n}'), { u: 'https://x//y', a: [1, 2] });
});

test('the CDN files: the paths the widget asks for; versioned names cached for good, the widget for five minutes', () => {
  const main = readFileSync(join(ROOT, 'widget/src/main.ts'), 'utf8');
  for (const u of UPLOADS) {
    assert.ok(main.includes(u.key.replace(/^w\/v1\//, 'w/v1/')) || main.includes(u.key.split('/').pop()!), `${u.key} is what the widget loads`);
    assert.match(u.cache, /\/w\/|widget/.test(u.key) ? /max-age=300$/ : /immutable/);
  }
});

test('T110: Hyperdrive reaches the database through the tunnel — host and Access token, never a port; the token is not a Worker secret', () => {
  const url = 'postgresql://tajribah_app_login:p%40ss@pg.tajribah.org:5432/tajribah';
  assert.deepEqual(hyperdriveArgs('tajribah-app', url, { id: 'abc.access', secret: 'cfast_x' }), [
    'hyperdrive', 'create', 'tajribah-app', '--host=pg.tajribah.org', '--database=tajribah', '--user=tajribah_app_login', '--password=p@ss',
    '--access-client-id=abc.access', '--access-client-secret=cfast_x',
  ]);
  assert.deepEqual(hyperdriveArgs('x', url), ['hyperdrive', 'create', 'x', '--connection-string=' + url], 'without a token: the plain string');
  assert.deepEqual(secretsOf({ AUTH_SECRET: 'a', HYPERDRIVE_ACCESS_CLIENT_ID: 'i', HYPERDRIVE_ACCESS_CLIENT_SECRET: 's' }, {}), { AUTH_SECRET: 'a' });
});

test('T117: staging shares nothing it could write to with production, is closed to search engines, and boots', () => {
  const staging = parseJsonc(readFileSync(join(ROOT, 'deploy/staging.jsonc'), 'utf8'));
  const ids = (c: typeof production) => [
    ...c.r2_buckets.map((b: { bucket_name: string }) => `r2:${b.bucket_name}`),
    ...c.kv_namespaces.map((k: { id: string }) => `kv:${k.id}`),
    ...c.hyperdrive.map((h: { id: string }) => `hd:${h.id}`),
    ...c.queues.producers.map((q: { queue: string }) => `q:${q.queue}`),
    `worker:${c.name}`,
    ...c.routes.map((r: { pattern: string }) => `route:${r.pattern}`),
  ];
  const shared = ids(staging).filter((id) => ids(production).includes(id) && !id.endsWith(':SET_ON_SERVER_DAY'));
  assert.deepEqual(shared, [], 'no bucket, store, database connection, queue, Worker or address in common');
  assert.equal(staging.vars.SITE_NOINDEX, '1', 'staging tells crawlers to stay out');
  assert.equal(production.vars.SITE_NOINDEX, undefined, 'production never does');
  assert.equal(staging.vars.SITE_HOSTS, 'staging.tajribah.org');
  assert.ok(!staging.vars.R2_BUCKET_NAME.includes('tajribah-files') || staging.vars.R2_BUCKET_NAME.endsWith('-staging'));
  assert.deepEqual(staging.hyperdrive.map((h: { binding: string }) => h.binding).sort(), ['HYPERDRIVE_ADMIN', 'HYPERDRIVE_APP'], 'the same bindings as production');
  resetEnv();
  loadEnv({ ...staging.vars, ...secretsOf(filled, staging.vars) });
  resetEnv();
});
