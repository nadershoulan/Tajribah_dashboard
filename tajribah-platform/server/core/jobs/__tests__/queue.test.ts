import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { jobs } from '@/db/schema';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { backoffMs, cancel, claim, complete, deadLetters, enqueue, fail, releaseStale } from '@/server/core/jobs/queue';
import { clearHandlers, registerHandler, tick } from '@/server/core/jobs/runner';

test('a job round-trips: enqueue, claim, complete', async () => {
  const harness = await createTestDb();
    const db = harness.db;
  try {
    const a = await seedTenant(harness, 'alpha');
    const job = await enqueue({ queue: 'sync.products', tenantId: a.tenantId, payload: { full: true } });
    assert.equal(job.state, 'queued');

    const [claimed] = await claim({ worker: 'w1' });
    assert.equal(claimed.id, job.id);
    assert.equal(claimed.state, 'claimed');
    assert.equal(claimed.attempts, 1, 'claiming counts as an attempt');

    // A second worker finds nothing — the compare-and-set is the lock.
    assert.deepEqual(await claim({ worker: 'w2' }), []);

    await complete(job.id);
    const [after] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    assert.equal(after.state, 'done');
  } finally { await harness.close(); }
});

test('dedupeKey makes enqueue idempotent', async () => {
  const harness = await createTestDb();
    const db = harness.db;
  try {
    const a = await seedTenant(harness, 'alpha');
    const first = await enqueue({ queue: 'edge.publish-config', tenantId: a.tenantId, dedupeKey: 'cfg:p1' });
    const second = await enqueue({ queue: 'edge.publish-config', tenantId: a.tenantId, dedupeKey: 'cfg:p1' });
    assert.equal(second.id, first.id, 'the same key must return the same job');
    assert.equal((await db.select().from(jobs)).length, 1);
  } finally { await harness.close(); }
});

test('one tenant cannot occupy a whole batch', async () => {
  const harness = await createTestDb();
  try {
    const noisy = await seedTenant(harness, 'noisy');
    const quiet = await seedTenant(harness, 'quiet');

    // The loud merchant queues a full import; the quiet one queues two jobs afterwards.
    for (let i = 0; i < 50; i++) {
      await enqueue({ queue: 'sync.products', tenantId: noisy.tenantId, payload: { i } });
    }
    for (let i = 0; i < 2; i++) {
      await enqueue({ queue: 'sync.products', tenantId: quiet.tenantId, payload: { i } });
    }

    const batch = await claim({ worker: 'w1', limit: 10 });
    const byTenant = new Map<string, number>();
    for (const job of batch) byTenant.set(job.tenantId!, (byTenant.get(job.tenantId!) ?? 0) + 1);

    assert.ok(byTenant.get(noisy.tenantId)! <= 2,
      `noisy tenant took ${byTenant.get(noisy.tenantId)} of 10 — the 20% cap did not hold`);
    assert.ok((byTenant.get(quiet.tenantId) ?? 0) >= 1,
      'the quiet tenant was starved by the import');
  } finally { await harness.close(); }
});

test('priority is respected within a tenant', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    await enqueue({ queue: 'sync.products', tenantId: a.tenantId, priority: 100, payload: { tag: 'slow' } });
    await enqueue({ queue: 'edge.publish-config', tenantId: a.tenantId, priority: 10, payload: { tag: 'urgent' } });

    const [first] = await claim({ worker: 'w1', limit: 1 });
    assert.equal((first.payload as { tag: string }).tag, 'urgent',
      'merchant-visible work must not queue behind a bulk import');
  } finally { await harness.close(); }
});

test('a job scheduled for later is not claimed yet', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    await enqueue({ queue: 'notify.email', tenantId: a.tenantId, runAfter: new Date(Date.now() + 60_000) });
    assert.deepEqual(await claim({ worker: 'w1' }), []);
    assert.equal((await claim({ worker: 'w1', now: new Date(Date.now() + 61_000) })).length, 1);
  } finally { await harness.close(); }
});

test('failures back off, then go to the dead letter queue', async () => {
  const harness = await createTestDb();
    const db = harness.db;
  try {
    const a = await seedTenant(harness, 'alpha');
    const job = await enqueue({ queue: 'ai.generate-3d', tenantId: a.tenantId, maxAttempts: 2 });

    await claim({ worker: 'w1' });
    assert.equal(await fail(job.id, new Error('upstream 500')), 'queued', 'first failure retries');

    const [retried] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    assert.ok(retried.runAfter.getTime() > Date.now(), 'a retry must wait');
    assert.equal(retried.lastError, 'upstream 500');

    await claim({ worker: 'w1', now: new Date(Date.now() + 60_000) });
    assert.equal(await fail(job.id, new Error('upstream 500 again')), 'dead', 'attempts are spent');
    assert.equal((await deadLetters()).length, 1);
  } finally { await harness.close(); }
});

test('backoff grows and is capped', () => {
  assert.ok(backoffMs(1) < backoffMs(3), 'backoff must grow');
  assert.equal(backoffMs(100), 15 * 60 * 1000, 'and stop growing at 15 minutes');
});

test('a claim abandoned by a dead worker is released', async () => {
  const harness = await createTestDb();
    const db = harness.db;
  try {
    const a = await seedTenant(harness, 'alpha');
    const job = await enqueue({ queue: 'sync.products', tenantId: a.tenantId });
    await claim({ worker: 'crashed' });

    assert.equal(await releaseStale(5 * 60 * 1000), 0, 'a fresh claim is not stale');
    assert.equal(await releaseStale(0), 1, 'an expired lease is reclaimed');

    const [released] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    assert.equal(released.state, 'queued');
    assert.equal(released.claimedBy, null);
  } finally { await harness.close(); }
});

test('cancel stops a queued job and leaves a finished one alone', async () => {
  const harness = await createTestDb();
    const db = harness.db;
  try {
    const a = await seedTenant(harness, 'alpha');
    const queued = await enqueue({ queue: 'sync.products', tenantId: a.tenantId });
    const finished = await enqueue({ queue: 'sync.orders', tenantId: a.tenantId });
    await complete(finished.id);

    await cancel(queued.id);
    await cancel(finished.id);

    const rows = await db.select().from(jobs);
    assert.equal(rows.find((r) => r.id === queued.id)!.state, 'cancelled');
    assert.equal(rows.find((r) => r.id === finished.id)!.state, 'done', 'a done job is not cancellable');
  } finally { await harness.close(); }
});

test('the runner executes a handler and records the outcome', async () => {
  const harness = await createTestDb();
    const db = harness.db;
  clearHandlers();
  try {
    const a = await seedTenant(harness, 'alpha');
    const seen: string[] = [];
    registerHandler('system.cleanup', async (job) => { seen.push(job.id); });
    registerHandler('ai.embed', async () => { throw new Error('model unavailable'); });

    const ok = await enqueue({ queue: 'system.cleanup', tenantId: a.tenantId });
    const bad = await enqueue({ queue: 'ai.embed', tenantId: a.tenantId, maxAttempts: 1 });

    const result = await tick('w1', 10);
    assert.equal(result.claimed, 2);
    assert.equal(result.done, 1);
    assert.equal(result.failed, 1);
    assert.deepEqual(seen, [ok.id]);

    const rows = await db.select().from(jobs);
    assert.equal(rows.find((r) => r.id === ok.id)!.state, 'done');
    assert.equal(rows.find((r) => r.id === bad.id)!.state, 'dead');
    assert.match(rows.find((r) => r.id === bad.id)!.lastError!, /model unavailable/);
  } finally { clearHandlers(); await harness.close(); }
});
