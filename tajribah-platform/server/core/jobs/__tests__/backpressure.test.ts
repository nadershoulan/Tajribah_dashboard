/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P7 — worker autoscaling & backpressure. A new job nudges the `JOBS` queue so a consumer looks now
 * (or when it falls due); a failed nudge never fails the enqueue. A pass drains fair batches until
 * nothing is left or its time budget is spent — never starting a batch past the budget, never
 * abandoning one. The sweeps run each on their own. Boot refuses `cf-queue` without its binding.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { jobs } from '@/db/schema';
import { resetEnv } from '@/server/core/config/env';
import { bootstrap } from '@/server/core/http/bootstrap';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { backoffMs, claim, enqueue, fail } from '@/server/core/jobs/queue';
import { MAX_DELAY_SECONDS, configureJobs } from '@/server/core/jobs/nudge';
import { clearHandlers, drain, registerHandler } from '@/server/core/jobs/runner';
import { oldestDueSeconds, runQueuePass, scheduled } from '@/server/worker/main';

setLogLevel('error');

function fakeQueue(options: { throws?: boolean } = {}) {
  const sent: { body: any; delaySeconds?: number }[] = [];
  return {
    sent,
    async send(body: unknown, opts?: { delaySeconds?: number }) {
      if (options.throws) throw new Error('queue unavailable');
      sent.push({ body, delaySeconds: opts?.delaySeconds });
    },
  };
}

test('a new job wakes a consumer — now, or when it falls due; a lost nudge loses no job', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    // inline (local): nothing is sent.
    const quiet = fakeQueue();
    configureJobs({ JOBS_MODE: 'inline' }, quiet);
    await enqueue({ queue: 'sync.products', tenantId: a.tenantId });
    assert.equal(quiet.sent.length, 0);

    assert.throws(() => configureJobs({ JOBS_MODE: 'cf-queue' }), /JOBS/);
    const q = fakeQueue();
    configureJobs({ JOBS_MODE: 'cf-queue' }, q);

    const now = await enqueue({ queue: 'edge.publish-config', tenantId: a.tenantId });
    assert.deepEqual(q.sent.at(-1), { body: { job: now.id, queue: 'edge.publish-config' }, delaySeconds: undefined });

    const later = await enqueue({ queue: 'sync.products', tenantId: a.tenantId, runAfter: new Date(Date.now() + 90_000) });
    assert.equal(q.sent.at(-1)!.body.job, later.id);
    assert.ok(Math.abs(q.sent.at(-1)!.delaySeconds! - 90) <= 1, 'delivered when the job falls due');

    const count = q.sent.length;
    await enqueue({ queue: 'sync.products', tenantId: a.tenantId, runAfter: new Date(Date.now() + (MAX_DELAY_SECONDS + 60) * 1000) });
    assert.equal(q.sent.length, count, 'beyond the longest delay: the minute pass finds it');

    const keyed = await enqueue({ queue: 'edge.publish-config', tenantId: a.tenantId, dedupeKey: 'cfg:x' });
    assert.equal(q.sent.at(-1)!.body.job, keyed.id);
    const again = q.sent.length;
    await enqueue({ queue: 'edge.publish-config', tenantId: a.tenantId, dedupeKey: 'cfg:x' });
    assert.equal(q.sent.length, again, 'the same job again sends nothing again');

    // A retry wakes a consumer when its backoff ends; a job out of attempts does not.
    const retried = await enqueue({ queue: 'webhooks.deliver', tenantId: a.tenantId, maxAttempts: 2 });
    await harness.asAdmin(() => harness.db.update(jobs).set({ state: 'claimed', attempts: 1 } as any).where(eq(jobs.id, retried.id)));
    const at = new Date();
    assert.equal(await fail(retried.id, new Error('boom'), at), 'queued');
    assert.deepEqual(q.sent.at(-1), { body: { job: retried.id, queue: 'webhooks.deliver' }, delaySeconds: Math.ceil(backoffMs(1) / 1000) });
    await harness.asAdmin(() => harness.db.update(jobs).set({ state: 'claimed', attempts: 2 } as any).where(eq(jobs.id, retried.id)));
    const before = q.sent.length;
    assert.equal(await fail(retried.id, new Error('boom')), 'dead');
    assert.equal(q.sent.length, before);

    // The queue down: the enqueue still succeeds, and the row is there for the next pass.
    configureJobs({ JOBS_MODE: 'cf-queue' }, fakeQueue({ throws: true }));
    const kept = await enqueue({ queue: 'sync.products', tenantId: a.tenantId });
    const [row] = await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.id, kept.id)));
    assert.equal(row!.state, 'queued');
  } finally {
    configureJobs({ JOBS_MODE: 'inline' });
    await harness.close();
  }
});

test('a pass drains until idle or out of budget — the batch in flight finishes, none starts late', async () => {
  const harness = await createTestDb();
  clearHandlers();
  try {
    const tenants = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((n) => seedTenant(harness, `t-${n}`)));
    for (let i = 0; i < 30; i++) await enqueue({ queue: 'sync.inventory', tenantId: tenants[i % 5]!.tenantId });
    let now = 0;
    const ran: string[] = [];
    registerHandler('sync.inventory', async (job) => { ran.push(job.id); now += 1_000; }); // each job takes a second
    const clock = () => now;

    // 15 s budget, batches of 10: two batches start (at 0 s and 10 s); the second ends at 20 s,
    // past the budget, and is not cut short; no third starts.
    const first = await drain({ worker: 'w', budgetMs: 15_000, batch: 10, clock });
    assert.deepEqual([first.stoppedBy, first.batches, first.claimed, first.done], ['budget', 2, 20, 20]);
    assert.equal(first.ms, 20_000);
    assert.equal((await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.state, 'queued')))).length, 10, 'the rest wait for the next pass');

    const second = await drain({ worker: 'w', budgetMs: 15_000, batch: 10, clock });
    assert.deepEqual([second.stoppedBy, second.claimed, second.done], ['idle', 10, 10]);
    assert.equal(new Set(ran).size, 30, 'every job once');

    // No budget: nothing starts.
    await enqueue({ queue: 'sync.inventory', tenantId: tenants[0]!.tenantId });
    const none = await drain({ worker: 'w', budgetMs: 0, batch: 10, clock });
    assert.deepEqual([none.stoppedBy, none.batches, none.claimed], ['budget', 0, 0]);

    // Other work sharing the pass keeps it going while it has something to do.
    let webhooks = 3;
    const shared = await drain({ worker: 'w', budgetMs: 60_000, batch: 10, clock, extra: async () => (webhooks > 0 ? webhooks-- : 0) });
    assert.deepEqual([shared.stoppedBy, shared.claimed, shared.extra, shared.batches], ['idle', 1, 6, 4]);
  } finally {
    clearHandlers();
    await harness.close();
  }
});

test('one failing sweep does not stop the others; the queue pass runs the real handlers', async () => {
  const done: string[] = [];
  const failed = await scheduled([
    ['first', async () => { done.push('first'); }],
    ['broken', async () => { throw new Error('database hiccup'); }],
    ['last', async () => { done.push('last'); }],
  ]);
  assert.equal(failed, 1);
  assert.deepEqual(done, ['first', 'last']);

  const harness = await createTestDb();
  clearHandlers();
  try {
    assert.equal(await oldestDueSeconds(), null);
    for (let i = 0; i < 3; i++) await enqueue({ queue: 'system.cleanup' });
    await harness.asAdmin(() => harness.db.update(jobs).set({ runAfter: new Date(Date.now() - 300_000) } as any));
    const lag = await oldestDueSeconds();
    assert.ok(lag !== null && lag >= 299 && lag <= 302, `waiting five minutes (got ${lag})`);
    const result = await runQueuePass();
    assert.deepEqual([result.stoppedBy, result.claimed, result.done, result.failed], ['idle', 3, 3, 0]);
    assert.equal(await oldestDueSeconds(), null);
    assert.deepEqual(await claim({ worker: 'x' }), []);
    await enqueue({ queue: 'system.cleanup', runAfter: new Date(Date.now() + 3_600_000) });
    assert.equal(await oldestDueSeconds(), null, 'a job due later is not behind');
  } finally {
    clearHandlers();
    await harness.close();
  }
});

test('boot refuses cf-queue without the JOBS queue bound', () => {
  resetEnv();
  const BASE = { APP_URL: 'http://localhost:5173', AUTH_SECRET: 'a'.repeat(40), ENCRYPTION_KEY: 'b'.repeat(40) };
  assert.throws(() => bootstrap({ ...BASE, JOBS_MODE: 'cf-queue' }), /no queue binding \(JOBS\)/);
  resetEnv();
  bootstrap({ ...BASE, JOBS_MODE: 'cf-queue', JOBS: fakeQueue() });
  resetEnv();
  bootstrap(BASE);
  resetEnv();
});
