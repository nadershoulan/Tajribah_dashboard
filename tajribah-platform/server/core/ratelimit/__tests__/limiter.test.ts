/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P7 — rate limiting that holds in production: the KV limiter (shared by every isolate) counts,
 * refuses without writing, says how long is left, and resets every window; the environment picks
 * it and production refuses the per-isolate one; and the endpoints that send email, fetch a shop
 * page or build a report each ask before doing the work — and only for valid input.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { invitations } from '@/db/schema';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { bootstrap } from '@/server/core/http/bootstrap';
import { setEmailSender } from '@/server/core/notify/notify';
import { setLogLevel } from '@/server/core/observability/log';
import {
  configureRateLimiter, KvRateLimiter, LIMITS, MemoryRateLimiter, rateLimiter, setRateLimiter,
  type RateLimiter, type RateLimitKv,
} from '@/server/core/ratelimit/limiter';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, enablePlanFeature, seedTenant, type TestDb } from '@/server/testing/harness';
import { analyticsCsv } from '@/server/modules/analytics/metrics';
import { checkInstall } from '@/server/modules/embed/service';
import { invite } from '@/server/modules/team/service';

setLogLevel('error');

/** A KV namespace in memory that counts its writes. */
function fakeKv() {
  const data = new Map<string, string>();
  const calls = { get: 0, put: 0, delete: 0 };
  const kv: RateLimitKv = {
    async get(key) { calls.get++; return data.get(key) ?? null; },
    async put(key, value) { calls.put++; data.set(key, value); },
    async delete(key) { calls.delete++; data.delete(key); },
  };
  return { kv, data, calls };
}

test('KV limiter: counts to the limit, then refuses without writing; Retry-After is what is left of the window', async () => {
  const { kv, calls } = fakeKv();
  let now = Date.UTC(2026, 8, 29, 10, 0, 15); // 15 s into a minute
  const limiter = new KvRateLimiter(kv, () => now);
  for (let i = 1; i <= 3; i++) {
    const r = await limiter.hit('k', 3, 60);
    assert.deepEqual([r.allowed, r.remaining, r.retryAfter], [true, 3 - i, 45]);
  }
  const writes = calls.put;
  for (let i = 0; i < 50; i++) assert.equal((await limiter.hit('k', 3, 60)).allowed, false);
  assert.equal(calls.put, writes, 'a hammered, blocked key costs reads, not writes');
  assert.equal((await limiter.hit('other', 3, 60)).allowed, true, 'keys are separate');
  now += 45_000; // the next minute
  assert.equal((await limiter.hit('k', 3, 60)).allowed, true, 'a new window starts clean');
});

test('KV limiter: reset clears the current window of every length the platform uses — 15 minutes included', async () => {
  const { kv } = fakeKv();
  const now = Date.UTC(2026, 8, 29, 10, 7, 0);
  const limiter = new KvRateLimiter(kv, () => now);
  const login = LIMITS.login; // 15 minutes — the window the old reset never reached
  for (let i = 0; i < login.limit; i++) await limiter.hit('login:a@b.test', login.limit, login.windowSeconds);
  assert.equal((await limiter.hit('login:a@b.test', login.limit, login.windowSeconds)).allowed, false);
  assert.equal((await limiter.hit('login:a@b.test', 1, 60)).allowed, true, 'another window length, another counter');
  await limiter.reset('login:a@b.test');
  assert.equal((await limiter.hit('login:a@b.test', login.limit, login.windowSeconds)).allowed, true, 'reset reached the 15-minute window');
});

test('the environment picks the limiter; kv needs its binding; production refuses the per-isolate one', () => {
  configureRateLimiter({ RATE_LIMITER: 'memory' });
  assert.ok(rateLimiter() instanceof MemoryRateLimiter);
  assert.throws(() => configureRateLimiter({ RATE_LIMITER: 'kv' }), /RATE_LIMITS/);
  configureRateLimiter({ RATE_LIMITER: 'kv' }, fakeKv().kv);
  assert.ok(rateLimiter() instanceof KvRateLimiter);

  resetEnv();
  const BASE = { APP_URL: 'http://localhost:5173', AUTH_SECRET: 'a'.repeat(40), ENCRYPTION_KEY: 'b'.repeat(40) };
  bootstrap({ ...BASE, RATE_LIMITER: 'kv', RATE_LIMITS: fakeKv().kv });
  assert.ok(rateLimiter() instanceof KvRateLimiter, 'bootstrap installs it from the RATE_LIMITS binding');
  resetEnv();
  assert.throws(() => bootstrap({ ...BASE, RATE_LIMITER: 'kv' }), /RATE_LIMITS/, 'kv without the binding does not half-start');
  resetEnv();
  assert.throws(() => loadEnv({ ...BASE, NODE_ENV: 'production' }), /RATE_LIMITER: memory rate limits are not allowed in production/);
  resetEnv();
  setRateLimiter(new MemoryRateLimiter());
});

/** Records every key asked about; refuses the ones named. */
function recording(refuse: (key: string) => boolean) {
  const asked: string[] = [];
  const limiter: RateLimiter = {
    async hit(key, limit, windowSeconds) {
      asked.push(`${key}|${limit}|${windowSeconds}`);
      return refuse(key) ? { allowed: false, remaining: 0, retryAfter: 1234 } : { allowed: true, remaining: limit - 1, retryAfter: windowSeconds };
    },
    async reset() {},
  };
  return { limiter, asked };
}
async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}

test('invitations, install checks and exports each ask per store — and are refused before the email, the fetch or the report', async () => {
  const harness = await createTestDb();
  const mail: unknown[] = [];
  setEmailSender({ async send(message: unknown) { mail.push(message); } } as any);
  try {
    const a = await store(harness, 'alpha');
    await enablePlanFeature(harness, 'starter', 'full_analytics');
    const config = { authSecret: 's'.repeat(40), appUrl: 'https://app.example.test' };
    let fetched = 0;
    const fetchStub = (async () => { fetched++; return new Response('<html></html>'); }) as unknown as typeof fetch;

    const allow = recording(() => false);
    setRateLimiter(allow.limiter);
    await invite(a.ctx, { email: 'sara@example.test', role: 'editor' }, config);
    await checkInstall(a.ctx, 'https://shop.example.sa/p/1', fetchStub, async () => ['93.184.216.34']);
    await analyticsCsv(a.ctx, '7d');
    assert.deepEqual(allow.asked, [
      `invite:${a.tenantId}|${LIMITS.invite.limit}|${LIMITS.invite.windowSeconds}`,
      `install-check:${a.tenantId}|${LIMITS.installCheck.limit}|${LIMITS.installCheck.windowSeconds}`,
      `analytics-export:${a.tenantId}|${LIMITS.analyticsExport.limit}|${LIMITS.analyticsExport.windowSeconds}`,
    ]);

    const refuse = recording(() => true);
    setRateLimiter(refuse.limiter);
    const [mails, fetches] = [mail.length, fetched];
    const limited = (e: any) => e.code === 'rate_limited' && e.status === 429 && e.retryAfter === 1234;
    await assert.rejects(() => invite(a.ctx, { email: 'lee@example.test', role: 'viewer' }, config), limited);
    await assert.rejects(() => checkInstall(a.ctx, 'https://shop.example.sa/p/1', fetchStub, async () => ['93.184.216.34']), limited);
    await assert.rejects(() => analyticsCsv(a.ctx, '7d'), limited);
    assert.equal(mail.length, mails, 'no email');
    assert.equal(fetched, fetches, 'no fetch');
    const rows = await harness.asAdmin(() => harness.db.select().from(invitations).where(eq(invitations.email, 'lee@example.test')));
    assert.equal(rows.length, 0, 'no invitation');

    // Input that is refused anyway costs nothing.
    const before = refuse.asked.length;
    await assert.rejects(() => invite(a.ctx, { email: 'not an email', role: 'viewer' }, config), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => checkInstall(a.ctx, 'http://127.0.0.1/', fetchStub), (e: any) => e.code === 'validation_failed');
    assert.equal(refuse.asked.length, before);
  } finally {
    setRateLimiter(new MemoryRateLimiter());
    await harness.close();
  }
});
