import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGISTRY, loadEnv, resetEnv } from '@/server/core/config/env';
import { renderEnvExample } from '@/server/core/config/env-example';

const VALID = {
  APP_URL: 'http://localhost:5173',
  AUTH_SECRET: 'a'.repeat(32),
  ENCRYPTION_KEY: 'b'.repeat(32),
};

test('the committed .env.example is exactly what the registry renders', () => {
  const committed = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
  assert.equal(committed, renderEnvExample(),
    '.env.example is out of date — run: node scripts/gen-env-example.mjs --modules <toolkit>/node_modules');
});

test('every registry variable appears in the template, once', () => {
  const names = renderEnvExample().split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => l.split('=')[0]);
  assert.deepEqual(names.sort(), Object.keys(REGISTRY).sort());
});

test('the template never carries something that looks like a real secret', () => {
  const lines = renderEnvExample().split('\n');
  for (const [name, entry] of Object.entries(REGISTRY)) {
    if (!('secret' in entry) || !entry.secret) continue;
    const value = lines.find((l) => l.startsWith(`${name}=`))!.slice(name.length + 1);
    assert.ok(value === '' || /^generate-/.test(value), `${name} example must be empty or a "generate-…" hint, got "${value}"`);
  }
});

test('boot fails loudly, listing every problem at once', () => {
  resetEnv();
  assert.throws(() => loadEnv({}), (error: Error) => {
    for (const name of ['APP_URL', 'AUTH_SECRET', 'ENCRYPTION_KEY']) {
      assert.match(error.message, new RegExp(`${name}:`), `${name} missing from the report`);
    }
    return true;
  });
  resetEnv();
  assert.throws(() => loadEnv({ ...VALID, AUTH_SECRET: 'short' }), /AUTH_SECRET:/);
  resetEnv();
  assert.throws(() => loadEnv({ ...VALID, EMAIL_PROVIDER: 'resend' }), /RESEND_API_KEY: required[\s\S]*EMAIL_FROM: required/);
  resetEnv();
  const env = loadEnv(VALID);
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.SESSION_TTL_MINUTES, 15, 'defaults apply');
  resetEnv();
});

test('production refuses every development stand-in', () => {
  resetEnv();
  assert.throws(() => loadEnv({ ...VALID, NODE_ENV: 'production' }), (error: Error) => {
    for (const name of ['SMS_PROVIDER', 'JOBS_MODE', 'STORAGE_PROVIDER']) assert.match(error.message, new RegExp(`${name}:`));
    return true;
  });
  resetEnv();
});

test('T110: production accepts SMS switched off (none) — never the console stand-in', () => {
  resetEnv();
  const ready = { ...VALID, NODE_ENV: 'production', JOBS_MODE: 'cf-queue', STORAGE_PROVIDER: 'r2', CDN_BASE_URL: 'https://cdn.example', CONFIG_STORE: 'kv', RATE_LIMITER: 'kv' };
  assert.doesNotThrow(() => loadEnv({ ...ready, SMS_PROVIDER: 'none' }));
  resetEnv();
  assert.throws(() => loadEnv({ ...ready, SMS_PROVIDER: 'console' }), /SMS_PROVIDER: console SMS is not allowed in production/);
  resetEnv();
});
