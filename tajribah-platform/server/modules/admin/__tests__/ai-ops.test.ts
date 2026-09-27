/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A9 — AI operations for staff: jobs by type and outcome, what the work cost us beside the credits
 * merchants were charged (a refunded job nets to zero), failures with the provider's own text,
 * jobs gone quiet, where the money goes; cancelling a quiet one with a reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { aiJobEvents, aiJobs, auditLogs, staffAudit, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { QUIET_MS, aiOperations, cancelJobForStore } from '@/server/modules/admin/ai-ops';
import { AiJobError, cancelAiJob, clearExecutors, createAiJob, registerExecutor, runAiJob } from '@/server/modules/ai-jobs/lifecycle';
import { creditSummary } from '@/server/modules/billing/credits';

setLogLevel('error');

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name); // Starter: 5 credits a month
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}
const run = (tenantId: string, id: string) => runAiJob({ tenantId, aiJobId: id, attempt: 1, maxAttempts: 1, requestId: 't' });

test('what ran, what it cost, what was charged, what failed and what went quiet — and a staff cancel', async () => {
  clearExecutors();
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const b = await store(harness, 'bravo');
    const staffId = uuidv7();
    await harness.asAdmin(() => harness.db.insert(users).values({ id: staffId, email: 'staff@tajribah.test', passwordHash: 'x', fullName: 'Staff', isStaff: true, totpEnabled: true } as any));
    const staff: StaffContext = { userId: staffId, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'staff-req' };

    registerExecutor('generate_3d', async (job) => {
      if ((job.input as any).fail) throw new AiJobError('provider_failed', 'meshy: 500 upstream timeout on task tsk_91', { retryable: false, cost: { actualCostCents: 12 } });
      return { output: {}, cost: { actualCostCents: 40, gpuSeconds: 30 } };
    });
    registerExecutor('embed_product', async () => ({ output: {}, cost: { actualCostCents: 1 } }));

    const done = await createAiJob(a.ctx, { type: 'generate_3d', input: {}, creditsCost: 2 });
    await run(a.tenantId, done.id);
    const failed = await createAiJob(a.ctx, { type: 'generate_3d', input: { fail: true }, creditsCost: 2 });
    await run(a.tenantId, failed.id); // refunded: nets to zero credits
    const embedded = await createAiJob(b.ctx, { type: 'embed_product', input: {}, creditsCost: 1 });
    await run(b.tenantId, embedded.id);
    const cancelled = await createAiJob(b.ctx, { type: 'embed_product', input: {}, creditsCost: 1 });
    await cancelAiJob(b.ctx, cancelled.id); // before it ran: refunded
    // A job the provider went silent on: processing, last heard long ago.
    const quiet = await createAiJob(b.ctx, { type: 'generate_3d', input: {}, creditsCost: 2 });
    await harness.asAdmin(async () => {
      await harness.db.update(aiJobs).set({ status: 'processing', startedAt: new Date(Date.now() - QUIET_MS * 2) } as any).where(eq(aiJobs.id, quiet.id));
      await harness.db.update(aiJobEvents).set({ createdAt: new Date(Date.now() - QUIET_MS * 2) } as any).where(eq(aiJobEvents.jobId, quiet.id));
    });

    const ops = await aiOperations(30);
    assert.equal(ops.totals.jobs, 5);
    assert.equal(ops.totals.costCents, 40 + 12 + 1, 'every cent the providers charged, failed work included');
    assert.equal(ops.totals.creditsCharged, 2 + 0 + 1 + 0 + 2, 'a refunded job nets to zero; the quiet one is still charged');
    assert.equal(ops.totals.failureRate, 1 / 3, 'failed over finished; a merchant’s cancel is not a failure');

    const gen = ops.byType.find((t) => t.type === 'generate_3d')!;
    assert.deepEqual([gen.total, gen.done, gen.failed, gen.open, gen.costCents, gen.gpuSeconds, gen.creditsCharged], [3, 1, 1, 1, 52, 30, 4]);
    assert.equal(typeof gen.medianSeconds, 'number');
    const emb = ops.byType.find((t) => t.type === 'embed_product')!;
    assert.deepEqual([emb.total, emb.done, emb.cancelled, emb.creditsCharged], [2, 1, 1, 1]);

    assert.deepEqual(ops.failures.map((f) => [f.id, f.errorCode, f.store.id]), [[failed.id, 'provider_failed', a.tenantId]]);
    assert.match(ops.failures[0]!.errorMessage!, /tsk_91/, 'staff see the provider’s own words');
    assert.deepEqual(ops.quiet.map((q) => q.id), [quiet.id]);
    assert.deepEqual(ops.topStores.map((s) => [s.id, s.jobs, s.costCents]), [[a.tenantId, 2, 52], [b.tenantId, 3, 1]]);

    // Cancel the quiet one for the store: a reason is required; T24 — the provider was working, so the charge stays.
    await assert.rejects(() => cancelJobForStore(staff, quiet.id, 'no'), (e: any) => e.code === 'validation_failed');
    const before = (await creditSummary(b.ctx)).balance;
    await cancelJobForStore(staff, quiet.id, 'provider silent for 40 minutes');
    assert.equal((await creditSummary(b.ctx)).balance, before, 'kept: it had started (T24)');
    assert.equal((await aiOperations(30)).quiet.length, 0);
    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit).where(eq(staffAudit.targetId, quiet.id)));
    assert.deepEqual(trail.map((t) => [t.action, t.storeId, t.reason]), [['ai_job.cancel', b.tenantId, 'provider silent for 40 minutes']]);
    const storeTrail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(and(eq(auditLogs.resourceId, quiet.id), eq(auditLogs.actorType, 'staff'))));
    assert.equal(storeTrail.length, 1, 'the store’s own activity shows Tajribah staff');
    await assert.rejects(() => cancelJobForStore(staff, uuidv7(), 'a real reason'), (e: any) => e.code === 'not_found');

    assert.equal((await aiOperations(7, new Date(Date.now() + 8 * 86_400_000))).totals.jobs, 0, 'the window is honoured');
  } finally { await harness.close(); }
});
