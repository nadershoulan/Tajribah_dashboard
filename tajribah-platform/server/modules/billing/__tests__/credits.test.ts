/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P2.9 — AI credits: an append-only ledger whose balance is the sum of its rows, one row per
 * reference, plan credits that expire with their month, bought credits that do not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asc, eq } from 'drizzle-orm';
import { auditLogs, creditLedger, subscriptions } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { currentUsage } from '@/server/core/billing/entitlements';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import { adjustCredits, consumeCredits, creditSummary, purchaseCredits, refundCredits } from '@/server/modules/billing/credits';

setLogLevel('error');

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}
const OCT = new Date('2026-10-05T09:00:00Z');
const NOV = new Date('2026-11-02T09:00:00Z');
/** `base` plus `n` minutes: entries in a test happen one after another, as they would. */
const at = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);
/** A Postgres refusal arrives wrapped by the query layer; look at the whole cause chain. */
const refusedWith = (pattern: RegExp) => (e: any) => {
  for (let x = e; x; x = x.cause) if (pattern.test(String(x.message))) return true;
  return false;
};
const job = () => uuidv7();

async function rows(harness: TestDb, tenantId: string) {
  return harness.asAdmin(() => harness.db.select().from(creditLedger).where(eq(creditLedger.tenantId, tenantId)).orderBy(asc(creditLedger.createdAt), asc(creditLedger.id)));
}

test('the month’s plan grant, spending, a retried job, a refused overspend, a purchase and a refund — each once', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha'); // Starter: 5 AI credits a month
    const other = await store(harness, 'bravo');

    const first = await creditSummary(ctx, at(OCT, 0));
    assert.deepEqual([first.balance, first.grantedThisPeriod, first.usedThisPeriod, first.planRemaining], [5, 5, 0, 5]);

    const a = job();
    await consumeCredits(ctx, 3, a, at(OCT, 1));
    await consumeCredits(ctx, 3, a, at(OCT, 2)); // the job retried: the same row
    assert.equal((await creditSummary(ctx, at(OCT, 3))).balance, 2);

    const b = job();
    await assert.rejects(() => consumeCredits(ctx, 3, b, at(OCT, 4)), (e: any) => e.code === 'conflict' && /2 left, 3 needed/.test(e.message));

    const payment = uuidv7();
    await purchaseCredits(ctx, 10, payment, at(OCT, 5));
    await purchaseCredits(ctx, 10, payment, at(OCT, 6)); // the payment webhook delivered twice
    await consumeCredits(ctx, 3, b, at(OCT, 7));
    let summary = await creditSummary(ctx, at(OCT, 8));
    assert.deepEqual([summary.balance, summary.usedThisPeriod, summary.planRemaining], [9, 6, 0], 'the plan’s 5 were spent first');

    await refundCredits(ctx, b, at(OCT, 9));
    await refundCredits(ctx, b, at(OCT, 10)); // once
    assert.equal(await refundCredits(ctx, job(), at(OCT, 11)), null, 'nothing to refund for a job that never ran');
    summary = await creditSummary(ctx, at(OCT, 12));
    assert.deepEqual([summary.balance, summary.usedThisPeriod], [12, 3]);
    assert.equal(await currentUsage(ctx, 'ai_credits', OCT), 3, 'the quota reads the same use');

    const ledger = await rows(harness, tenantId);
    assert.deepEqual(ledger.map((r) => r.reason), ['plan_grant', 'consumption', 'purchase', 'consumption', 'refund']);
    let running = 0;
    for (const r of ledger) { running += r.delta; assert.equal(r.balanceAfter, running, 'balance_after is the running sum'); }

    assert.equal((await creditSummary(other.ctx, OCT)).balance, 5, 'another store has its own ledger');
  } finally { await harness.close(); }
});

test('a new month: last month’s unused plan credits expire, bought ones stay, the new grant arrives — once', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    await consumeCredits(ctx, 3, job(), at(OCT, 1));   // 2 of October's 5 unused
    await purchaseCredits(ctx, 10, uuidv7(), at(OCT, 2));
    assert.equal((await creditSummary(ctx, at(OCT, 3))).balance, 12);

    const nov = await creditSummary(ctx, NOV);
    assert.deepEqual([nov.balance, nov.grantedThisPeriod, nov.usedThisPeriod, nov.planRemaining], [15, 5, 0, 5],
      '12 − 2 expired + 5 granted; the 10 bought remain');
    await creditSummary(ctx, at(NOV, 1));
    await consumeCredits(ctx, 1, job(), at(NOV, 2));
    const ledger = await rows(harness, tenantId);
    assert.deepEqual(ledger.map((r) => [r.reason, r.delta]).slice(-3), [['expiry', -2], ['plan_grant', 5], ['consumption', -1]], 'one expiry, one grant');
    assert.equal(ledger.at(-3)!.createdAt.toISOString(), '2026-10-31T20:59:59.999Z', 'the expiry belongs to the last instant of October in Riyadh');
    let running = 0;
    for (const r of ledger) { running += r.delta; assert.equal(r.balanceAfter, running); }
  } finally { await harness.close(); }
});

test('append-only: the app role cannot change or delete a row, and the reference index refuses a second one', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const a = job();
    await consumeCredits(ctx, 1, a, OCT);
    await assert.rejects(() => withTenant(tenantId, (db) => db.update(creditLedger, eq(creditLedger.reason, 'consumption'), { delta: 0 })), refusedWith(/permission denied/));
    await assert.rejects(() => withTenant(tenantId, (db) => db.delete(creditLedger, eq(creditLedger.reason, 'consumption'))), refusedWith(/permission denied/));
    await assert.rejects(() => withTenant(tenantId, (db) => db.insert(creditLedger, {
      id: uuidv7(), delta: -1, balanceAfter: 0, reason: 'consumption', referenceType: 'ai_job', referenceId: a,
    } as never)), refusedWith(/duplicate key|unique/i), 'even written around the service');
  } finally { await harness.close(); }
});

test('an unlimited plan records use without a balance; adjustments need a reason, are audited, and never go below zero', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const enterprise = await seededPlanId(harness, 'enterprise');
    await harness.asAdmin(() => harness.db.insert(subscriptions).values({
      tenantId, planId: enterprise, status: 'active', currentPeriodStart: OCT, currentPeriodEnd: NOV,
    } as never));
    const used = await consumeCredits(ctx, 40, job(), OCT);
    assert.deepEqual([used.delta, used.reason], [0, 'consumption']);
    assert.match(used.note!, /40 credits/);
    assert.equal((await creditSummary(ctx, OCT)).unlimited, true);

    await assert.rejects(() => adjustCredits(ctx, 5, '  ', OCT), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => adjustCredits(ctx, -1, 'correction', OCT), (e: any) => e.code === 'conflict');
    await adjustCredits(ctx, 7, 'goodwill after a failed batch', OCT);
    assert.equal((await creditSummary(ctx, OCT)).balance, 7);
    const audit = await harness.asAdmin(() => harness.db.select().from(auditLogs));
    assert.equal(audit.filter((r) => r.resourceType === 'credit_adjustment').length, 1);
  } finally { await harness.close(); }
});
