/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P7 — health and SLOs: alive answers without touching anything; ready answers 200 only when the
 * database does (503 with the reason otherwise, and never a secret); a hung database is a failed
 * check, not a hung monitor; every request's access line carries its budget, and one over it is
 * logged as slow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDb, pingDb, registerDb } from '@/db/client';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { route } from '@/server/core/observability/request';
import { budgetMs, SLO } from '@/server/core/observability/slo';
import { createTestDb } from '@/server/testing/harness';
import { liveHandler, readyHandler } from '@/server/modules/health/http';

const SECRET = 'q'.repeat(40);
const boot = () => { resetEnv(); loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: SECRET, ENCRYPTION_KEY: 'e'.repeat(40) }); };
const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const saved = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = saved; }
};

test('alive: 200, touching nothing — not even the database', async () => {
  boot();
  clearDb();
  const response = await quietly(() => liveHandler(new Request('https://app.test/api/health')));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  resetEnv();
});

test('ready: 200 when the database answers; 503 with the reason when it does not; adapters by name, no secrets', async () => {
  boot();
  clearDb();
  const down = await quietly(() => readyHandler(new Request('https://app.test/api/health/ready')));
  assert.equal(down.status, 503);
  const body = await down.json() as any;
  assert.deepEqual([body.status, body.checks.database], ['unavailable', 'not_registered']);
  assert.deepEqual(body.adapters, { environment: 'development', storage: 'memory', configs: 'memory', rateLimits: 'memory', jobs: 'inline' });
  assert.ok(!JSON.stringify(body).includes(SECRET));

  const harness = await createTestDb();
  try {
    const up = await quietly(() => readyHandler(new Request('https://app.test/api/health/ready')));
    assert.equal(up.status, 200);
    assert.deepEqual((await up.json() as any).checks, { database: 'ok' });
  } finally { await harness.close(); resetEnv(); }
});

test('a database that hangs or throws is a failed check, answered within the timeout', { timeout: 5000 }, async () => {
  const hung = { execute: () => new Promise(() => {}) } as any;
  registerDb(hung, hung);
  const started = Date.now();
  assert.equal(await pingDb(50), 'error');
  assert.ok(Date.now() - started < 1000);
  const broken = { execute: async () => { throw new Error('connection refused'); } } as any;
  registerDb(broken, broken);
  assert.equal(await pingDb(50), 'error');
  clearDb();
});

test('the SLO budgets are the plan\'s, and a request over its budget is logged as slow', async () => {
  assert.equal(budgetMs('GET', '/api/products'), 300);
  assert.equal(budgetMs('HEAD', '/api/products'), 300);
  assert.equal(budgetMs('POST', '/api/products'), 800);
  assert.equal(budgetMs('POST', '/api/analytics/collect'), SLO.eventIngestP99Ms);
  assert.equal(budgetMs('POST', '/v1/e'), SLO.eventIngestP99Ms, 'the collector on ev.tajribah.org');

  const lines: any[] = [];
  const saved = { log: console.log, warn: console.warn };
  console.log = (t: unknown) => lines.push(JSON.parse(String(t)));
  console.warn = (t: unknown) => lines.push(JSON.parse(String(t)));
  try {
    await route(async () => new Response('fast'))(new Request('https://app.test/api/fast'));
    await route(async () => { await new Promise((r) => setTimeout(r, 330)); return new Response('slow'); })(new Request('https://app.test/api/slow'));
  } finally { Object.assign(console, saved); }
  const access = lines.filter((l) => l.message === 'request');
  assert.deepEqual(access.map((l) => [l.path, l.budgetMs]), [['/api/fast', 300], ['/api/slow', 300]]);
  const slow = lines.filter((l) => l.message === 'slow request');
  assert.deepEqual(slow.map((l) => [l.level, l.path, l.budgetMs]), [['warn', '/api/slow', 300]]);
  assert.ok(slow[0].ms > 300);
});
