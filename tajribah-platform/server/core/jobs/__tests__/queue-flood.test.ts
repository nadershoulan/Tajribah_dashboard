/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P7 load test 5 of 5 — the queue flood (plan §8): 10,000 3D jobs queued at once by one store;
 * fair scheduling, no starvation. Run in process against the real queue (`claim`), so it runs on
 * every change, not only at a gate: nine other stores queue a few jobs *after* the flood, and each
 * batch the workers claim must (a) never give the flooding store more than its 20% share and (b)
 * reach the others' jobs at once — not after the flood drains.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { claim, complete, enqueue, FAIR_SHARE } from '@/server/core/jobs/queue';
import { createTestDb, seedTenant } from '@/server/testing/harness';

const FLOOD = 10_000;
const BATCH = 10;

test(`a flood of ${FLOOD} 3D jobs from one store does not starve nine others`, { timeout: 120_000 }, async () => {
  const harness = await createTestDb();
  try {
    const noisy = await seedTenant(harness, 'noisy');
    const others = [];
    for (let i = 0; i < 9; i++) others.push(await seedTenant(harness, `quiet${i}`));

    // The flood: queued first (older), all at once — written in chunks as enqueue would write them.
    const start = Date.now() - 60_000;
    for (let i = 0; i < FLOOD; i += 1000) {
      const rows = Array.from({ length: Math.min(1000, FLOOD - i) }, (_, k) => ({
        id: uuidv7(start + i + k), queue: 'ai.generate-3d', tenantId: noisy.tenantId, payload: { n: i + k },
        state: 'queued', priority: 100, runAfter: new Date(start + i + k), maxAttempts: 3,
      }));
      await harness.asAdmin(() => harness.db.insert(jobs).values(rows as any));
    }
    // Then the others, each a few jobs, after the flood.
    const waiting = new Set<string>();
    for (const store of others) {
      for (let k = 0; k < 3; k++) waiting.add((await enqueue({ queue: 'ai.generate-3d', tenantId: store.tenantId, payload: { k } })).id);
    }

    const cap = Math.max(1, Math.floor(BATCH * FAIR_SHARE));
    let batches = 0;
    while (waiting.size && batches < 50) {
      const batch = await claim({ worker: `w${batches}`, queues: ['ai.generate-3d'], limit: BATCH });
      batches += 1;
      const noisyTook = batch.filter((j) => j.tenantId === noisy.tenantId).length;
      assert.ok(noisyTook <= cap, `batch ${batches}: the flooding store took ${noisyTook} of ${batch.length}`);
      for (const job of batch) { waiting.delete(job.id); await complete(job.id); }
    }
    // 27 jobs from 9 stores, at most 2 per store per batch, 8 places a batch beside the flood: 4 batches.
    assert.equal(waiting.size, 0, `${waiting.size} of the other stores' jobs still waiting after ${batches} batches`);
    assert.ok(batches <= 4, `the others waited ${batches} batches`);
  } finally { await harness.close(); }
});
