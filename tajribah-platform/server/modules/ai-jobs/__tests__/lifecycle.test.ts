/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P3.2 ⭐ — the AI job lifecycle: charged once, refunded once, every transition conditional, a
 * cancel that is immediate, a late result thrown away, and nothing left behind by a dead worker.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, asc, eq } from 'drizzle-orm';
import { aiJobEvents, aiJobs, auditLogs, creditLedger, jobs, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { AI_JOB_ERRORS } from '@/lib/ai-jobs';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { claim } from '@/server/core/jobs/queue';
import { clearHandlers, registerHandler, tick } from '@/server/core/jobs/runner';
import { configureNotify } from '@/server/core/notify/notify';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { creditSummary } from '@/server/modules/billing/credits';
import { registerHandler as registerAccount } from '@/server/modules/auth/http';
import {
  AiJobError, aiJobView, cancelAiJob, clearExecutors, createAiJob, listAiJobs, registerExecutor, runAiJob,
  type AiExecutor,
} from '@/server/modules/ai-jobs/lifecycle';
import { handleAiJob } from '@/server/modules/ai-jobs/job';
import { ABANDONED_MS, UNDISPATCHED_MS, sweepAiJobs } from '@/server/modules/ai-jobs/sweep';
import { aiJobHandler, cancelAiJobHandler, listAiJobsHandler } from '@/server/modules/ai-jobs/http';

setLogLevel('error');

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name); // Starter: 5 AI credits a month
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

const GENERATE = { type: 'generate_3d' as const, input: { productId: 'p-1', photos: 4 }, creditsCost: 2 };

async function eventsOf(harness: TestDb, jobId: string) {
  const rows = await harness.asAdmin(() => harness.db.select().from(aiJobEvents).where(eq(aiJobEvents.jobId, jobId)).orderBy(asc(aiJobEvents.id)));
  return rows.map((r) => r.event);
}
async function rowOf(harness: TestDb, jobId: string) {
  const [row] = await harness.asAdmin(() => harness.db.select().from(aiJobs).where(eq(aiJobs.id, jobId)));
  return row!;
}
async function ledger(harness: TestDb, tenantId: string) {
  const rows = await harness.asAdmin(() => harness.db.select().from(creditLedger).where(eq(creditLedger.tenantId, tenantId)).orderBy(asc(creditLedger.createdAt), asc(creditLedger.id)));
  return rows.filter((r) => r.reason !== 'plan_grant').map((r) => `${r.reason}:${r.delta}`);
}
/** One delivery of `jobId`, as the queue would make it. */
const deliver = (tenantId: string, jobId: string, attempt = 1, maxAttempts = 3) =>
  runAiJob({ tenantId, aiJobId: jobId, attempt, maxAttempts, requestId: `test-${attempt}` });

function fresh() {
  clearExecutors();
  clearHandlers();
}

test('the happy path through the real worker: charged once, progress never backwards, done at 100, cost recorded, audited', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    let calls = 0;
    registerExecutor('generate_3d', async (job, report) => {
      calls++;
      assert.equal((job.input as any).productId, 'p-1');
      await report({ percent: 10, stage: 'preparing' });
      await report({ percent: 55, stage: 'generating' });
      await report({ percent: 40 }); // a provider that reports out of order
      assert.deepEqual([(await aiJobView(ctx, job.id)).percent, (await aiJobView(ctx, job.id)).stage], [55, 'generating'], 'never backwards');
      await report({ percent: 100, stage: 'checking' });
      assert.equal((await aiJobView(ctx, job.id)).percent, 99, 'not 100 until it is done');
      return { output: { modelVersionId: 'mv-1' }, cost: { actualCostCents: 42, gpuSeconds: 90 } };
    });
    registerHandler('ai.generate-3d', handleAiJob);

    const created = await createAiJob(ctx, GENERATE);
    assert.deepEqual([created.status, created.percent, created.canCancel, created.creditsCost], ['queued', 0, true, 2]);
    assert.equal((await creditSummary(ctx)).balance, 3, 'charged when dispatched');

    const result = await tick('worker-1');
    assert.deepEqual([result.claimed, result.done, result.failed], [1, 1, 0]);
    const done = await aiJobView(ctx, created.id);
    assert.deepEqual([done.status, done.percent, done.stage, done.canCancel, done.error, done.refunded], ['done', 100, null, false, null, false]);
    const row = await rowOf(harness, created.id);
    assert.deepEqual([row.actualCostCents, row.gpuSeconds, row.attempts, (row.output as any).modelVersionId], [42, 90, 1, 'mv-1']);
    assert.deepEqual(await eventsOf(harness, created.id), ['queued', 'charged', 'dispatched', 'started', 'progress', 'progress', 'progress', 'cost', 'done']);

    // Delivered again (a worker died after the work but before `complete`): nothing happens.
    await deliver(tenantId, created.id);
    assert.equal(calls, 1, 'the executor is not run for a finished job');
    assert.deepEqual(await ledger(harness, tenantId), ['consumption:-2'], 'charged exactly once, never refunded');
    const [audit] = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceType, 'ai_job'))));
    assert.equal(audit?.action, 'create');
    assert.equal((await listAiJobs(ctx))[0]?.id, created.id);
    assert.deepEqual(await listAiJobs(ctx, { active: true }), []);
  } finally { await harness.close(); }
});

test('not enough credits: 409, the job is failed with the reason, nothing is queued and nothing charged', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    await assert.rejects(() => createAiJob(ctx, { ...GENERATE, creditsCost: 6 }), (e: any) => e.code === 'conflict' && /5 left, 6 needed/.test(e.message));
    const [job] = await listAiJobs(ctx);
    assert.deepEqual([job!.status, job!.error?.code, job!.error?.message.en], ['failed', 'insufficient_credits', AI_JOB_ERRORS.insufficient_credits.en]);
    const queued = await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.tenantId, tenantId)));
    assert.equal(queued.length, 0, 'never reaches the queue');
    assert.deepEqual(await ledger(harness, tenantId), []);
    await assert.rejects(() => createAiJob(ctx, { ...GENERATE, creditsCost: 0 }), (e: any) => e.code === 'validation_failed');
  } finally { await harness.close(); }
});

test('cancel before it starts: immediate, credits back once, the worker then does nothing; cancelling again is a 409', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    let ran = false;
    registerExecutor('generate_3d', async () => { ran = true; return { output: {} }; });
    const job = await createAiJob(ctx, GENERATE);

    const cancelled = await cancelAiJob(ctx, job.id);
    assert.deepEqual([cancelled.status, cancelled.canCancel, cancelled.refunded], ['cancelled', false, true]);
    assert.equal((await creditSummary(ctx)).balance, 5);
    await deliver(tenantId, job.id);
    assert.equal(ran, false, 'a cancelled job is never run');
    await assert.rejects(() => cancelAiJob(ctx, job.id), (e: any) => e.code === 'conflict' && /already ended: cancelled/.test(e.message));
    assert.deepEqual(await ledger(harness, tenantId), ['consumption:-2', 'refund:2']);
  } finally { await harness.close(); }
});

test('cancel mid-run: the next report says stop; a late result is thrown away, its cost recorded, and the credits kept (T24)', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    let heard: boolean | null = null;
    registerExecutor('generate_3d', async (job, report) => {
      await report({ percent: 30, stage: 'generating' });
      assert.equal((await aiJobView(ctx, job.id)).canCancel, true);
      await cancelAiJob(ctx, job.id); // the merchant, while the provider works
      heard = (await report({ percent: 60 })).cancelled;
      return { output: { modelVersionId: 'late' }, cost: { actualCostCents: 37 } };
    });
    const job = await createAiJob(ctx, GENERATE);
    await deliver(tenantId, job.id);

    assert.equal(heard, true, 'the executor is told to stop');
    const row = await rowOf(harness, job.id);
    assert.deepEqual([row.status, row.output, row.actualCostCents], ['cancelled', null, 37]);
    const events = await eventsOf(harness, job.id);
    assert.ok(events.includes('result_discarded') && !events.includes('done'));
    assert.deepEqual(await ledger(harness, tenantId), ['consumption:-2'], 'the provider was already working: charged, not refunded (T24)');
    const seen = await aiJobView(ctx, job.id);
    assert.deepEqual([seen.status, seen.refunded], ['cancelled', false]);
  } finally { await harness.close(); }
});

test('a retryable failure goes back to the queue and succeeds; both attempts’ costs add up; charged once', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    let attempt = 0;
    registerExecutor('generate_3d', async () => {
      attempt++;
      if (attempt === 1) throw new AiJobError('provider_failed', 'upstream 503', { retryable: true, cost: { actualCostCents: 30 } });
      return { output: { ok: true }, cost: { actualCostCents: 20 } };
    });
    const job = await createAiJob(ctx, GENERATE);
    await assert.rejects(() => deliver(tenantId, job.id, 1), /upstream 503/, 'rethrown so the queue backs off');
    const between = await aiJobView(ctx, job.id);
    assert.deepEqual([between.status, between.canCancel], ['queued', true]);
    await deliver(tenantId, job.id, 2);
    const row = await rowOf(harness, job.id);
    assert.deepEqual([row.status, row.actualCostCents, row.attempts], ['done', 50, 2]);
    assert.deepEqual(await ledger(harness, tenantId), ['consumption:-2']);
    assert.ok((await eventsOf(harness, job.id)).includes('retrying'));
  } finally { await harness.close(); }
});

test('failures end the job with the merchant’s wording, never the provider’s, and credits back once', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    registerExecutor('generate_3d', async () => { throw new AiJobError('bad_input', 'provider says: photo 3 has EXIF secret-internal-id'); });
    registerExecutor('enhance_texture', async () => { throw new Error('socket hang up'); });

    const bad = await createAiJob(ctx, GENERATE);
    await deliver(tenantId, bad.id, 1); // not retryable: ends on the first attempt, no throw
    const seen = await aiJobView(ctx, bad.id);
    assert.deepEqual([seen.status, seen.error?.code, seen.refunded], ['failed', 'bad_input', true]);
    assert.ok(!JSON.stringify(seen).includes('secret-internal-id'), 'the provider’s text is not shown');
    assert.match((await rowOf(harness, bad.id)).errorMessage ?? '', /secret-internal-id/, 'staff still have it');

    const flaky = await createAiJob(ctx, { ...GENERATE, type: 'enhance_texture', creditsCost: 1 });
    await assert.rejects(() => deliver(tenantId, flaky.id, 1, 2)); // an unknown error is retried...
    await deliver(tenantId, flaky.id, 2, 2); // ...until the attempts are spent
    assert.deepEqual([(await aiJobView(ctx, flaky.id)).status, (await aiJobView(ctx, flaky.id)).error?.code], ['failed', 'provider_failed']);

    const orphan = await createAiJob(ctx, { ...GENERATE, type: 'convert_format', creditsCost: 1 }); // no executor yet
    await deliver(tenantId, orphan.id);
    assert.equal((await aiJobView(ctx, orphan.id)).error?.code, 'not_available');

    assert.deepEqual(await ledger(harness, tenantId), ['consumption:-2', 'refund:2', 'consumption:-1', 'refund:1', 'consumption:-1', 'refund:1']);
  } finally { await harness.close(); }
});

test('the sweep: an undispatched job is dispatched once; an abandoned one fails as timed out; a quiet-but-alive one is left', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const now = new Date();
    const old = new Date(now.getTime() - UNDISPATCHED_MS - 60_000);
    // A row whose process died before the charge: written straight, as createAiJob's first step would.
    const lost = uuidv7();
    await harness.asAdmin(() => harness.db.insert(aiJobs).values({ id: lost, tenantId, type: 'generate_3d', status: 'queued', input: {}, creditsCost: 2, queuedAt: old } as any));

    registerExecutor('generate_3d', async (_job, report) => { await report({ percent: 5 }); return { output: {} }; });
    const stuck = await createAiJob(ctx, GENERATE);
    const alive = await createAiJob(ctx, { ...GENERATE, creditsCost: 1 });
    for (const id of [stuck.id, alive.id]) {
      const [queued] = await claim({ worker: 'w', queues: ['ai.generate-3d'], limit: 1 });
      assert.ok(queued);
      await harness.asAdmin(() => harness.db.update(aiJobs).set({ status: 'processing' } as any).where(eq(aiJobs.id, id)));
    }
    const quiet = new Date(now.getTime() - ABANDONED_MS - 60_000);
    await harness.asAdmin(() => harness.db.update(aiJobEvents).set({ createdAt: quiet } as any).where(eq(aiJobEvents.jobId, stuck.id)));

    const swept = await sweepAiJobs(now);
    assert.deepEqual(swept, { redispatched: 1, abandoned: 1 });
    assert.deepEqual(await sweepAiJobs(now), { redispatched: 0, abandoned: 0 }, 'a second sweep finds nothing');
    assert.ok((await eventsOf(harness, lost)).includes('dispatched'));
    const dispatched = await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.dedupeKey, `ai-job:${lost}`)));
    assert.equal(dispatched.length, 1);
    assert.deepEqual([(await aiJobView(ctx, stuck.id)).status, (await aiJobView(ctx, stuck.id)).error?.code], ['failed', 'timed_out']);
    assert.equal((await aiJobView(ctx, alive.id)).status, 'processing');
    // lost -2, stuck -2 then +2, alive -1: every job charged once, the abandoned one refunded once.
    assert.equal((await creditSummary(ctx)).balance, 5 - 2 - 1);
  } finally { await harness.close(); }
});

test('who may do what: an analyst can watch but not start or cancel; another store sees nothing', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const other = await store(harness, 'bravo');
    const analystId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: analystId, email: 'an@example.test', passwordHash: 'pbkdf2$sha256$1$x$x', fullName: 'A' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId: analystId, role: 'analyst', status: 'active' } as any);
    });
    const analyst = await buildTenantContext({ actor: { userId: analystId, email: 'an@example.test', isStaff: false }, tenantId, requestId: 'r' });

    const job = await createAiJob(ctx, GENERATE);
    assert.equal((await aiJobView(analyst, job.id)).id, job.id);
    await assert.rejects(() => createAiJob(analyst, GENERATE), (e: any) => e.code === 'forbidden');
    await assert.rejects(() => cancelAiJob(analyst, job.id), (e: any) => e.code === 'forbidden');
    await assert.rejects(() => aiJobView(other.ctx, job.id), (e: any) => e.code === 'not_found');
    await assert.rejects(() => cancelAiJob(other.ctx, job.id), (e: any) => e.code === 'not_found');
    assert.deepEqual(await listAiJobs(other.ctx), []);
  } finally { await harness.close(); }
});

test('over HTTP: list, one job, cancel — and the refusals', async () => {
  fresh();
  resetEnv();
  const APP = 'http://localhost:5173';
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  const harness = await createTestDb();
  const original = console.log;
  try {
    console.log = () => {};
    const response = await registerAccount(new Request(`${APP}/api/auth/register`, {
      method: 'POST', headers: { origin: APP, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'o@example.test', password: 'a-long-enough-password', fullName: 'O', storeName: 'Alpha' }),
    }));
    console.log = original;
    const body = await response.json() as any;
    const auth = { authorization: `Bearer ${body.accessToken}`, origin: APP };
    const ctx = await buildTenantContext({ actor: { userId: body.user.id, email: 'o@example.test', isStaff: false }, tenantId: body.tenant.id, requestId: 'r' });
    const job = await createAiJob(ctx, GENERATE);

    const listed = await (await listAiJobsHandler(new Request(`${APP}/api/ai-jobs?active=1`, { headers: auth }))).json() as any;
    assert.deepEqual(listed.jobs.map((j: any) => j.id), [job.id]);
    const one = await aiJobHandler(new Request(`${APP}/api/ai-jobs/${job.id}`, { headers: auth }));
    assert.equal(((await one.json()) as any).status, 'queued');
    assert.equal(one.headers.get('cache-control'), 'no-store');

    const cancel = (headers: Record<string, string>, id = job.id) => cancelAiJobHandler(new Request(`${APP}/api/ai-jobs/${id}/cancel`, { method: 'POST', headers }));
    assert.equal((await cancel({ ...auth, origin: 'https://evil.example' })).status, 403, 'cross-site cancel refused');
    const done = await cancel(auth);
    assert.equal(((await done.json()) as any).status, 'cancelled');
    assert.equal((await cancel(auth)).status, 409);
    assert.equal((await cancel(auth, 'not-a-uuid')).status, 404);
    assert.equal((await aiJobHandler(new Request(`${APP}/api/ai-jobs/${uuidv7()}`, { headers: auth }))).status, 404);
    assert.equal((await listAiJobsHandler(new Request(`${APP}/api/ai-jobs`))).status, 401);
  } finally { console.log = original; await harness.close(); }
});

// Keep the executor type exercised at compile time for adapters written later.
const _typed: AiExecutor = async (_job, report) => { await report({ percent: 1 }); return { output: {} }; };
void _typed;
