/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P6 — the model registry & A/B. A job's model is decided by its id (the same id, the same model),
 * in proportion to the shares; the choice is written on the job. Staff add models (off, 0%), switch
 * them on (0% beside others, everything alone), set shares (every model that is on, whole percents,
 * 100 in all) and roll one back (its share to the others, in proportion, still 100). Every change is
 * logged with its reason. How each model did comes from its jobs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { aiJobs, modelRegistry, staffAudit, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, enablePlanFeature, seedTenant } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { listRegistry, registerModel, setModelActive, setSplits, shares } from '@/server/modules/admin/models';
import { bucketOf, chooseModel, pick } from '@/server/modules/ai-jobs/models';
import { purchaseCredits } from '@/server/modules/billing/credits';
import { AiJobError, clearExecutors, createAiJob, registerExecutor, runAiJob } from '@/server/modules/ai-jobs/lifecycle';

setLogLevel('error');

test('a job id always lands in the same place, and places are spread evenly', () => {
  const id = uuidv7();
  assert.equal(bucketOf(id), bucketOf(id));
  const counts = new Array<number>(10).fill(0);
  for (let i = 0; i < 20_000; i++) {
    const b = bucketOf(uuidv7(Date.now() + i));
    assert.ok(Number.isInteger(b) && b >= 0 && b < 100);
    counts[Math.floor(b / 10)]! += 1;
  }
  for (const c of counts) assert.ok(c > 1_700 && c < 2_300, `each tenth of the range gets about 2,000 of 20,000 (got ${c})`);
});

test('the split follows the shares; no share, no choice', () => {
  const models = [{ id: 'a', abSplitPercent: 30 }, { id: 'b', abSplitPercent: 70 }];
  assert.equal(pick(models, 0), 'a');
  assert.equal(pick(models, 29), 'a');
  assert.equal(pick(models, 30), 'b');
  assert.equal(pick(models, 99), 'b');
  assert.equal(pick([{ id: 'a', abSplitPercent: 0 }, { id: 'b', abSplitPercent: 100 }], 0), 'b', 'a 0% model never takes a job');
  assert.equal(pick([{ id: 'a', abSplitPercent: 0 }], 50), null);
  assert.equal(pick([], 50), null);
  // Shares that do not add up to 100 are scaled, not dropped.
  assert.equal(pick([{ id: 'a', abSplitPercent: 1 }, { id: 'b', abSplitPercent: 1 }], 49), 'a');
  assert.equal(pick([{ id: 'a', abSplitPercent: 1 }, { id: 'b', abSplitPercent: 1 }], 50), 'b');
  let a = 0;
  for (let i = 0; i < 20_000; i++) if (pick(models, bucketOf(uuidv7(Date.now() + i))) === 'a') a++;
  assert.ok(a > 5_400 && a < 6_600, `about 30% to a (got ${a} of 20,000)`);
});

test('a share handed back goes to the others in proportion, whole percents, 100 in all', () => {
  const of = (w: [string, number][]) => Object.fromEntries(shares(w.map(([id, weight]) => ({ id, weight }))));
  assert.deepEqual(of([['b', 30], ['c', 20]]), { b: 60, c: 40 });
  assert.deepEqual(of([['b', 33], ['c', 33]]), { b: 50, c: 50 });
  assert.deepEqual(of([['b', 1], ['c', 1], ['d', 1]]), { b: 34, c: 33, d: 33 });
  assert.deepEqual(of([['d', 1], ['c', 1], ['b', 1]]), { b: 34, c: 33, d: 33 }, 'an exact tie goes by id, not by the order given');
  assert.deepEqual(of([['b', 10], ['c', 25], ['d', 25]]), { b: 17, c: 42, d: 41 }, 'largest remainder; a tie goes to the first by id');
  assert.deepEqual(of([['b', 0], ['c', 0]]), { b: 50, c: 50 }, 'all at 0%: shared equally');
  assert.deepEqual(of([['b', 0], ['c', 40]]), { b: 0, c: 100 });
  assert.deepEqual(of([]), {});
  for (let n = 1; n <= 7; n++) {
    const total = [...shares(Array.from({ length: n }, (_, i) => ({ id: `m${i}`, weight: (i * 7) % 5 + 1 }))).values()].reduce((x, y) => x + y, 0);
    assert.equal(total, 100, `${n} models still add up to 100`);
  }
});

test('register, switch on, split, choose, roll back — every step logged with its reason; outcomes from the jobs', async () => {
  clearExecutors();
  const harness = await createTestDb();
  try {
    const seeded = await seedTenant(harness, 'alpha');
    await enablePlanFeature(harness, 'starter', 'ai_3d');
    await enablePlanFeature(harness, 'starter', 'recommendations'); // product embeddings
    const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
    await purchaseCredits(ctx, 200, uuidv7()); // room for every job below
    const staffId = uuidv7();
    await harness.asAdmin(() => harness.db.insert(users).values({ id: staffId, email: 'staff@tajribah.test', passwordHash: 'x', fullName: 'Staff', isStaff: true, totpEnabled: true } as any));
    const staff: StaffContext = { userId: staffId, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'staff-req' };
    const why = 'trying the new provider';
    const input = { name: 'mesh-a', version: '2.1', provider: 'acme', endpoint: 'https://api.acme.test/v2', jobType: 'quality_check', costPerCallCents: 40, reason: why };

    // Registering: checked, and it starts off at 0%.
    const bad = async (patch: Record<string, unknown>, field: string) =>
      assert.rejects(() => registerModel(staff, { ...input, ...patch } as any), (e: any) => e.code === 'validation_failed' && field in (e.errors ?? {}), field);
    await bad({ reason: 'no' }, 'reason');
    await bad({ endpoint: 'http://api.acme.test' }, 'endpoint');
    await bad({ jobType: 'mine_bitcoin' }, 'jobType');
    await bad({ costPerCallCents: -1 }, 'costPerCallCents');
    await bad({ costPerCallCents: 1.5 }, 'costPerCallCents');
    await bad({ name: '  ' }, 'name');
    const a = await registerModel(staff, input);
    assert.deepEqual([a.active, a.split, a.jobType, a.endpoint, a.outcomes], [false, 0, 'quality_check', 'https://api.acme.test/v2', null]);
    await assert.rejects(() => registerModel(staff, input), (e: any) => e.code === 'validation_failed', 'the same name and version twice');
    const b = await registerModel(staff, { ...input, name: 'mesh-b', endpoint: null, costPerCallCents: 25 });
    const other = await registerModel(staff, { ...input, name: 'embedder', jobType: 'embed_product' });

    // Nothing is on: new jobs go to the executor's default.
    const before = await createAiJob(ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
    assert.equal((await rowOf(harness, before.id)).modelRegistryId, null);

    // Switched on alone → everything. The second switched on → 0% until given a share.
    await assert.rejects(() => setModelActive(staff, a.id, true, 'x'), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => setModelActive(staff, uuidv7(), true, why), (e: any) => e.status === 404);
    await setModelActive(staff, a.id, true, why);
    await setModelActive(staff, b.id, true, why);
    await setModelActive(staff, other.id, true, why);
    assert.deepEqual(await splitsOf(), { 'mesh-a': 100, 'mesh-b': 0, embedder: 100 });
    for (let i = 0; i < 5; i++) {
      const job = await createAiJob(ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
      assert.equal((await rowOf(harness, job.id)).modelRegistryId, a.id, 'a 0% model gets no jobs');
    }
    const emb = await createAiJob(ctx, { type: 'embed_product', input: {}, creditsCost: 1 });
    assert.equal((await rowOf(harness, emb.id)).modelRegistryId, other.id, 'each kind of work has its own models');

    // Shares: every model that is on, whole percents, 100 in all, this kind of work only.
    const set = (splits: [string, number][], reason = why) => setSplits(staff, { jobType: 'quality_check', splits: splits.map(([id, percent]) => ({ id, percent })), reason });
    for (const wrong of [[[a.id, 50], [b.id, 40]], [[a.id, 100]], [[a.id, 50], [b.id, 50], [other.id, 0]], [[a.id, 50.5], [b.id, 49.5]], [[a.id, 150], [b.id, -50]]] as [string, number][][]) {
      await assert.rejects(() => set(wrong), (e: any) => e.code === 'validation_failed', JSON.stringify(wrong));
    }
    await assert.rejects(() => set([[a.id, 30], [b.id, 70]], 'no'), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => setSplits(staff, { jobType: 'nope', splits: [], reason: why }), (e: any) => e.code === 'validation_failed');
    assert.deepEqual(await splitsOf(), { 'mesh-a': 100, 'mesh-b': 0, embedder: 100 }, 'a refused change changes nothing');
    await set([[a.id, 30], [b.id, 70]]);
    assert.deepEqual(await splitsOf(), { 'mesh-a': 30, 'mesh-b': 70, embedder: 100 });

    // The job's model is the one its id chooses — and chooses again, every time.
    const chosen = new Map<string, number>();
    for (let i = 0; i < 60; i++) {
      const job = await createAiJob(ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
      const on = (await rowOf(harness, job.id)).modelRegistryId!;
      assert.equal(on, await chooseModel('quality_check', job.id));
      assert.equal(on, bucketOf(job.id) < 30 ? a.id : b.id, 'mesh-a (by name first) takes places 0–29');
      chosen.set(on, (chosen.get(on) ?? 0) + 1);
    }
    assert.ok((chosen.get(a.id) ?? 0) > 0 && (chosen.get(b.id) ?? 0) > (chosen.get(a.id) ?? 0), 'both take jobs, b the larger share');

    // How each did, from the jobs: b fails its runs, a finishes them.
    registerExecutor('quality_check', async (job) => {
      if (job.modelRegistryId === b.id) throw new AiJobError('provider_failed', 'b broke', { retryable: false, cost: { actualCostCents: 25 } });
      return { output: {}, cost: { actualCostCents: 40 } };
    });
    const jobs = await harness.asAdmin(() => harness.db.select({ id: aiJobs.id, model: aiJobs.modelRegistryId }).from(aiJobs).where(eq(aiJobs.type, 'quality_check')));
    for (const job of jobs.filter((j) => j.model)) await runAiJob({ tenantId: seeded.tenantId, aiJobId: job.id, attempt: 1, maxAttempts: 1, requestId: 't' });
    // One more of a's, still waiting: counted as a job, but not in its success rate.
    for (let waiting = null as string | null; waiting !== a.id;) {
      waiting = (await rowOf(harness, (await createAiJob(ctx, { type: 'quality_check', input: {}, creditsCost: 1 })).id)).modelRegistryId;
    }
    const waitingOnB = (await harness.asAdmin(() => harness.db.select({ id: aiJobs.id }).from(aiJobs).where(eq(aiJobs.modelRegistryId, b.id)))).length - jobs.filter((j) => j.model === b.id).length;
    const listed = await listRegistry();
    const outA = listed.find((m) => m.id === a.id)!.outcomes!;
    const outB = listed.find((m) => m.id === b.id)!.outcomes!;
    const nA = jobs.filter((j) => j.model === a.id).length;
    const nB = jobs.filter((j) => j.model === b.id).length;
    assert.deepEqual([outA.jobs, outA.done, outA.failed, outA.successRate, outA.costCents], [nA + 1, nA, 0, 1, nA * 40]);
    assert.deepEqual([outB.jobs, outB.done, outB.failed, outB.successRate, outB.costCents], [nB + waitingOnB, 0, nB, 0, nB * 25]);
    assert.equal(typeof outA.medianSeconds, 'number');
    assert.equal(outB.medianSeconds, null, 'a median of the finished ones only');

    // Roll b back: off, 0%, when recorded; its 70% goes to a. Jobs already given b keep it.
    await setModelActive(staff, b.id, false, 'b fails every job', true);
    const rolled = (await listRegistry()).find((m) => m.id === b.id)!;
    assert.deepEqual([rolled.active, rolled.split, typeof rolled.rolledBackAt], [false, 0, 'string']);
    assert.deepEqual(await splitsOf(), { 'mesh-a': 100, 'mesh-b': 0, embedder: 100 });
    assert.equal(jobs.filter((j) => j.model === b.id).length, nB);
    // A model that is off is never chosen, whatever share its row still holds.
    await harness.asAdmin(() => harness.db.update(modelRegistry).set({ abSplitPercent: 90 }).where(eq(modelRegistry.id, b.id)));
    for (let i = 0; i < 20; i++) assert.equal(await chooseModel('quality_check', uuidv7(Date.now() + i)), a.id);
    await harness.asAdmin(() => harness.db.update(modelRegistry).set({ abSplitPercent: 0 }).where(eq(modelRegistry.id, b.id)));
    const after = await createAiJob(ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
    assert.equal((await rowOf(harness, after.id)).modelRegistryId, a.id);
    await assert.rejects(() => set([[a.id, 30], [b.id, 70]]), (e: any) => e.code === 'validation_failed', 'a model that is off takes no share');

    // Switching b back on: 0% beside a, and the rollback mark cleared. Switching a off: b takes all.
    await setModelActive(staff, b.id, true, 'fixed by the provider');
    assert.deepEqual(await splitsOf(), { 'mesh-a': 100, 'mesh-b': 0, embedder: 100 });
    assert.equal((await listRegistry()).find((m) => m.id === b.id)!.rolledBackAt, null);
    await setModelActive(staff, a.id, false, 'moving over to b');
    assert.deepEqual(await splitsOf(), { 'mesh-a': 0, 'mesh-b': 100, embedder: 100 }, 'all at 0% but one left: it takes everything');
    await setModelActive(staff, a.id, false, 'already off, nothing to do');

    // Every change, with its reason and what the shares were before and after.
    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit).orderBy(staffAudit.createdAt, staffAudit.id));
    assert.deepEqual(trail.map((r) => r.action), [
      'ai.model.register', 'ai.model.register', 'ai.model.register', 'ai.model.on', 'ai.model.on', 'ai.model.on', 'ai.model.splits',
      'ai.model.rollback', 'ai.model.on', 'ai.model.off',
    ]);
    assert.ok(trail.every((r) => r.staffUserId === staffId && (r.reason ?? '').length >= 5));
    const splitsRow = trail.find((r) => r.action === 'ai.model.splits')!;
    assert.deepEqual(splitsRow.detail, { jobType: 'quality_check', before: { [a.id]: 100, [b.id]: 0 }, after: { [a.id]: 30, [b.id]: 70 } });
    const rollback = trail.find((r) => r.action === 'ai.model.rollback')!;
    assert.equal(rollback.reason, 'b fails every job');
    assert.deepEqual((rollback.detail as any).after, { [a.id]: 100, [b.id]: 0 });
    assert.deepEqual((rollback.detail as any).before, { [b.id]: 70, [a.id]: 30 });

    async function splitsOf() {
      const rows = await harness.asAdmin(() => harness.db.select().from(modelRegistry));
      return Object.fromEntries(rows.map((m) => [m.name, m.isActive ? m.abSplitPercent : 0]));
    }
  } finally {
    clearExecutors();
    await harness.close();
  }
});

async function rowOf(harness: Awaited<ReturnType<typeof createTestDb>>, id: string) {
  const [row] = await harness.asAdmin(() => harness.db.select().from(aiJobs).where(eq(aiJobs.id, id)));
  return row!;
}
