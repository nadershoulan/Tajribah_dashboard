/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P6.7 — AI cost guardrails: nothing limited until staff say so; a paused kind of work, the
 * platform's daily spend and a store's daily job count each refuse new work before any row or
 * charge; yesterday does not count; every change is validated and logged with its reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { aiJobs, creditLedger, staffAudit, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, enablePlanFeature, seedTenant, type TestDb } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { aiOperations, setGuardrails } from '@/server/modules/admin/ai-ops';
import { clearExecutors, createAiJob, registerExecutor, runAiJob } from '@/server/modules/ai-jobs/lifecycle';
import { currentGuardrails, riyadhDayStart, secondsToTomorrow } from '@/server/modules/ai-jobs/guardrails';

setLogLevel('error');

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name); // Starter: 5 credits a month
  await enablePlanFeature(harness, 'starter', 'ai_3d');
  await enablePlanFeature(harness, 'starter', 'recommendations');
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}
async function staffOf(harness: TestDb): Promise<StaffContext> {
  const id = uuidv7();
  await harness.asAdmin(() => harness.db.insert(users).values({ id, email: 'staff@tajribah.test', passwordHash: 'x', fullName: 'Staff', isStaff: true, totpEnabled: true } as any));
  return { userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'staff-req' };
}
const NONE = { pausedTypes: [] as string[], dailySpendCapCents: null, storeDailyJobsCap: null };
const run = (tenantId: string, id: string) => runAiJob({ tenantId, aiJobId: id, attempt: 1, maxAttempts: 1, requestId: 't' });
const jobsOf = (harness: TestDb, tenantId: string) => harness.asAdmin(() => harness.db.select().from(aiJobs).where(eq(aiJobs.tenantId, tenantId)));
const charges = async (harness: TestDb, tenantId: string) =>
  (await harness.asAdmin(() => harness.db.select().from(creditLedger).where(and(eq(creditLedger.tenantId, tenantId), eq(creditLedger.referenceType, 'ai_job'))))).length;

test('the Riyadh day: it starts at 21:00 UTC, and a refusal waits until then', () => {
  assert.equal(riyadhDayStart(new Date('2026-09-29T20:59:00Z')).toISOString(), '2026-09-28T21:00:00.000Z');
  assert.equal(riyadhDayStart(new Date('2026-09-29T21:00:00Z')).toISOString(), '2026-09-29T21:00:00.000Z');
  assert.equal(secondsToTomorrow(new Date('2026-09-29T20:59:00Z')), 60);
  assert.equal(secondsToTomorrow(new Date('2026-09-29T21:00:00Z')), 86_400);
});

test('nothing is limited until staff set it', async () => {
  clearExecutors();
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    assert.deepEqual({ ...(await currentGuardrails()), updatedAt: null }, { ...NONE, updatedAt: null });
    for (let i = 0; i < 4; i++) await createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
    assert.equal((await jobsOf(harness, a.tenantId)).length, 4);
  } finally { await harness.close(); }
});

test('a paused kind of work is refused before any row or charge; other kinds carry on; unpausing lets it back', async () => {
  clearExecutors();
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const staff = await staffOf(harness);
    await setGuardrails(staff, { ...NONE, pausedTypes: ['quality_check'], reason: 'provider overcharging' });

    await assert.rejects(() => createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 }),
      (e: any) => e.code === 'ai_paused' && e.status === 503 && /nothing was charged/.test(e.message));
    assert.equal((await jobsOf(harness, a.tenantId)).length, 0, 'no job row');
    assert.equal(await charges(harness, a.tenantId), 0, 'no charge');
    await createAiJob(a.ctx, { type: 'embed_product', input: {}, creditsCost: 1 }); // not paused

    await setGuardrails(staff, { ...NONE, reason: 'provider fixed its price' });
    await createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
    assert.equal((await jobsOf(harness, a.tenantId)).length, 2);

    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit).where(eq(staffAudit.action, 'ai.guardrails')));
    assert.equal(trail.length, 2);
    const first = trail.find((r) => r.reason === 'provider overcharging')!;
    assert.deepEqual((first.detail as any).before.pausedTypes, []);
    assert.deepEqual((first.detail as any).after.pausedTypes, ['quality_check']);
    assert.equal(first.staffUserId, staff.userId);
  } finally { await harness.close(); }
});

test("the platform's daily spend cap stops new work for every store once today's cost reaches it; yesterday does not count", async () => {
  clearExecutors();
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const b = await store(harness, 'bravo');
    const staff = await staffOf(harness);
    registerExecutor('quality_check', async () => ({ output: {}, cost: { actualCostCents: 40 } }));
    await setGuardrails(staff, { ...NONE, dailySpendCapCents: 80, reason: 'launch week budget' });

    const one = await createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
    await run(a.tenantId, one.id); // 40 of 80
    const two = await createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 }); // still under
    await run(a.tenantId, two.id); // 80 of 80: reached

    for (const s of [a, b]) {
      await assert.rejects(() => createAiJob(s.ctx, { type: 'embed_product', input: {}, creditsCost: 1 }),
        (e: any) => e.code === 'ai_paused' && e.retryAfter > 0 && e.retryAfter <= 86_400);
    }
    assert.equal((await jobsOf(harness, b.tenantId)).length, 0);
    const ops = await aiOperations(30);
    assert.equal(ops.guardrails.spentTodayCents, 80);
    assert.equal(ops.guardrails.dailySpendCapCents, 80);

    // The spend was yesterday's: today starts clean.
    const yesterday = new Date(riyadhDayStart().getTime() - 60_000);
    await harness.asAdmin(() => harness.db.update(aiJobs).set({ createdAt: yesterday } as any).where(eq(aiJobs.tenantId, a.tenantId)));
    await createAiJob(b.ctx, { type: 'embed_product', input: {}, creditsCost: 1 });
  } finally { await harness.close(); }
});

test("a store's daily job cap refuses its next job (429, until tomorrow) — not another store's; jobs refused for credits do not count", async () => {
  clearExecutors();
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const b = await store(harness, 'bravo');
    const staff = await staffOf(harness);
    await setGuardrails(staff, { ...NONE, storeDailyJobsCap: 2, reason: 'a script looping on one store' });

    await createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
    await assert.rejects(() => createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 99 }), (e: any) => e.code === 'conflict'); // no credits: costs nothing
    await createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 });
    await assert.rejects(() => createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 }),
      (e: any) => e.code === 'rate_limited' && e.status === 429 && e.retryAfter > 0 && /2 AI jobs for today/.test(e.message));
    assert.equal(await charges(harness, a.tenantId), 2, 'the refused job was never charged');
    await createAiJob(b.ctx, { type: 'quality_check', input: {}, creditsCost: 1 }); // another store
  } finally { await harness.close(); }
});

test('guardrails are checked when set: a reason, known kinds of work, whole non-negative caps', async () => {
  clearExecutors();
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const staff = await staffOf(harness);
    const bad = async (input: any, field: string) => assert.rejects(() => setGuardrails(staff, { ...NONE, reason: 'a real reason', ...input }),
      (e: any) => e.code === 'validation_failed' && field in e.errors);
    await bad({ reason: 'no' }, 'reason');
    await bad({ pausedTypes: ['mine_bitcoin'] }, 'pausedTypes');
    await bad({ dailySpendCapCents: -1 }, 'dailySpendCapCents');
    await bad({ dailySpendCapCents: 12.5 }, 'dailySpendCapCents');
    await bad({ storeDailyJobsCap: -3 }, 'storeDailyJobsCap');
    const set = await setGuardrails(staff, { pausedTypes: ['generate_3d', 'generate_3d'], dailySpendCapCents: 0, storeDailyJobsCap: 10, reason: 'zero means zero' });
    assert.deepEqual(set.pausedTypes, ['generate_3d'], 'once');
    assert.equal(set.dailySpendCapCents, 0, 'a zero cap is a cap, not "none"');
    assert.ok(set.updatedAt);
    await assert.rejects(() => createAiJob(a.ctx, { type: 'quality_check', input: {}, creditsCost: 1 }), (e: any) => e.code === 'ai_paused', 'and it stops everything');
  } finally { await harness.close(); }
});
