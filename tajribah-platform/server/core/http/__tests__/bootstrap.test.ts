import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { resetEnv } from '@/server/core/config/env';
import { bootstrap } from '@/server/core/http/bootstrap';
import { MemoryStorage, R2Storage, configureStorage, storage } from '@/server/core/storage/storage';
import * as authHttp from '@/server/modules/auth/http';
import * as onboardingHttp from '@/server/modules/onboarding/http';
import * as productsHttp from '@/server/modules/products/http';
import * as webhooksHttp from '@/server/modules/webhooks/http';
import * as modelsHttp from '@/server/modules/models/http';
import * as connectionsHttp from '@/server/modules/connections/http';

// Every module's handlers. A new module's http.ts is added here once.
const MODULE_HANDLERS: Record<string, Record<string, unknown>> = { auth: authHttp, onboarding: onboardingHttp, products: productsHttp, webhooks: webhooksHttp, models: modelsHttp, connections: connectionsHttp };

const BASE = { APP_URL: 'http://localhost:5173', AUTH_SECRET: 'a'.repeat(40), ENCRYPTION_KEY: 'b'.repeat(40) };

test('bootstrap reads string bindings, ignores objects, and installs the named adapters', () => {
  resetEnv();
  const bucket = { put() {}, get() {}, head() {}, delete() {}, list() {} };
  const env = bootstrap({ ...BASE, STORAGE_PROVIDER: 'r2', CDN_BASE_URL: 'https://cdn.example.test', BUCKET: bucket, SESSION_TTL_MINUTES: '20' });
  assert.equal(env.SESSION_TTL_MINUTES, 20);
  assert.ok(storage() instanceof R2Storage);
  resetEnv();
  configureStorage({ STORAGE_PROVIDER: 'memory' });
  assert.ok(storage() instanceof MemoryStorage);
});

test('a broken environment stops boot with every problem listed', () => {
  resetEnv();
  assert.throws(() => bootstrap({ APP_URL: 'not a url' }), (error: Error) => {
    for (const name of ['APP_URL', 'AUTH_SECRET', 'ENCRYPTION_KEY']) assert.match(error.message, new RegExp(`${name}:`));
    return true;
  });
  resetEnv();
});

/** Every `app/api/**\/route.ts`, as `{ path, method, handler }`. */
function routeFiles() {
  const root = join(process.cwd(), 'app', 'api');
  const found: { path: string; method: string; handler: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (entry !== 'route.ts') continue;
      const source = readFileSync(full, 'utf8');
      const matches = [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = withBoot\((\w+)\);/g)];
      assert.ok(matches.length, `${relative(process.cwd(), full)} must be \`export const METHOD = withBoot(handler);\``);
      const path = '/' + relative(join(process.cwd(), 'app'), dir).split(sep).join('/');
      for (const match of matches) found.push({ path: `${match[1]} ${path}`, method: match[1], handler: match[2] });
    }
  };
  walk(root);
  return found;
}

test('every handler has exactly one route file, and every route file names a real handler', () => {
  const routes = routeFiles();
  const handlers = Object.values(MODULE_HANDLERS).flatMap((mod) => Object.keys(mod).filter((name) => name.endsWith('Handler')));
  assert.deepEqual(routes.map((r) => r.handler).sort(), handlers.sort());
  const served = new Set(routes.map((r) => r.path));
  assert.ok(served.has('GET /api/auth/me'), 'reads are GET');
  assert.ok(served.has('POST /api/auth/login'));
  assert.equal(served.size, routes.length, 'no method + path is served twice');
});

test('every module with an http.ts is in the route map', () => {
  const root = join(process.cwd(), 'server', 'modules');
  const withHttp = readdirSync(root).filter((name) => {
    try { return statSync(join(root, name, 'http.ts')).isFile(); } catch { return false; }
  });
  assert.deepEqual(withHttp.sort(), Object.keys(MODULE_HANDLERS).sort(),
    'Add the new module to MODULE_HANDLERS so its routes are checked');
});
