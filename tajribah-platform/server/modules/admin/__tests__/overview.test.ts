/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A2 — the platform overview's figures, each checked against a planted set of stores.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { creditLedger, invoices, subscriptions, tenants } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, seededPlanId } from '@/server/testing/harness';
import { platformOverview } from '@/server/modules/admin/overview';

setLogLevel('error');
const NOW = new Date('2026-10-15T09:00:00Z');
const DAY = 86_400_000;

test('stores, trials, MRR/ARR from the plan rows, churn, invoices and AI credits — as planted', async () => {
  const harness = await createTestDb();
  try {
    const ids: Record<string, string> = {};
    for (const name of ['trialing', 'lapsed', 'monthly', 'annual', 'late', 'gone', 'held']) ids[name] = (await seedTenant(harness, name)).tenantId;
    const growth = await seededPlanId(harness, 'growth');
    const pro = await seededPlanId(harness, 'pro');
    const set = (name: string, patch: any) => harness.asAdmin(() => harness.db.update(tenants).set(patch).where(eq(tenants.id, ids[name])));
    await set('trialing', { status: 'trial', trialEndsAt: new Date(NOW.getTime() + 3 * DAY), createdAt: new Date(NOW.getTime() - 11 * DAY) });
    await set('lapsed', { status: 'trial', trialEndsAt: new Date(NOW.getTime() - DAY), createdAt: new Date(NOW.getTime() - 40 * DAY) });
    // Paid before its trial date, which is still two days away: not a trial ending.
    await set('monthly', { status: 'active', trialEndsAt: new Date(NOW.getTime() + 2 * DAY), createdAt: new Date(NOW.getTime() - 90 * DAY) });
    await set('annual', { status: 'active', createdAt: new Date(NOW.getTime() - 90 * DAY) });
    await set('late', { status: 'past_due', createdAt: new Date(NOW.getTime() - 90 * DAY) });
    await set('gone', { status: 'cancelled', createdAt: new Date(NOW.getTime() - 90 * DAY) });
    await set('held', { status: 'suspended', createdAt: new Date(NOW.getTime() - 90 * DAY) });
    const period = { currentPeriodStart: NOW, currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY) };
    await harness.asAdmin(() => harness.db.insert(subscriptions).values([
      { tenantId: ids.monthly, planId: growth, status: 'active', billingCycle: 'monthly', ...period },
      { tenantId: ids.annual, planId: pro, status: 'active', billingCycle: 'annual', ...period },
      { tenantId: ids.late, planId: growth, status: 'past_due', billingCycle: 'monthly', ...period },
      { tenantId: ids.gone, planId: growth, status: 'cancelled', billingCycle: 'monthly', cancelledAt: new Date(NOW.getTime() - 5 * DAY), ...period },
    ] as any));
    await harness.asAdmin(() => harness.db.insert(invoices).values([
      { id: uuidv7(), tenantId: ids.monthly, invoiceNumber: 'A-1', status: 'paid', subtotalMinor: 29_900, vatMinor: 4_485, totalMinor: 34_385, issuedAt: new Date('2026-10-02T09:00:00Z') },
      { id: uuidv7(), tenantId: ids.annual, invoiceNumber: 'A-2', status: 'paid', subtotalMinor: 999_000, vatMinor: 149_850, totalMinor: 1_148_850, issuedAt: new Date('2026-10-03T09:00:00Z') },
      { id: uuidv7(), tenantId: ids.annual, invoiceNumber: 'A-3', status: 'paid', subtotalMinor: 1, vatMinor: 0, totalMinor: 1, issuedAt: new Date('2026-09-20T09:00:00Z') }, // last month
      { id: uuidv7(), tenantId: ids.monthly, invoiceNumber: 'A-4', status: 'void', subtotalMinor: 5, vatMinor: 0, totalMinor: 5, issuedAt: new Date('2026-10-04T09:00:00Z') }, // void: not counted
    ] as any));
    await harness.asAdmin(() => harness.db.insert(creditLedger).values([
      { id: uuidv7(), tenantId: ids.monthly, delta: -3, balanceAfter: 37, reason: 'consumption', createdAt: new Date('2026-10-05T09:00:00Z') },
      { id: uuidv7(), tenantId: ids.annual, delta: -10, balanceAfter: 190, reason: 'consumption', createdAt: new Date('2026-10-06T09:00:00Z') },
      { id: uuidv7(), tenantId: ids.annual, delta: 10, balanceAfter: 200, reason: 'refund', createdAt: new Date('2026-10-06T10:00:00Z') },
      { id: uuidv7(), tenantId: ids.annual, delta: 200, balanceAfter: 200, reason: 'plan_grant', createdAt: new Date('2026-10-01T00:00:00Z') },
    ] as any));

    const o = await platformOverview(NOW);
    assert.deepEqual(o.stores, { total: 7, trial: 2, active: 2, pastDue: 1, suspended: 1, cancelled: 1, readOnly: 2 },
      'read-only: the lapsed trial and the cancelled subscription (a suspension is its own, stronger block)');
    assert.equal(o.newStores30d, 1);
    assert.equal(o.trialsEndingIn7d, 1);
    assert.deepEqual(o.subscriptionsByPlan, { starter: 0, growth: 2, pro: 1, enterprise: 0 }, 'active and past-due only');
    assert.equal(o.mrrMinor, 29_900 + 83_250 + 29_900, 'Growth monthly ×2 + Pro annual ÷ 12 (999,000 → 83,250)');
    assert.equal(o.arrMinor, o.mrrMinor * 12);
    assert.equal(o.churn30d, 1);
    assert.deepEqual(o.invoicesThisMonth, { count: 2, totalMinor: 34_385 + 1_148_850 });
    assert.equal(o.aiCreditsUsedThisMonth, 3, 'spent less refunded; grants are not use');
  } finally { await harness.close(); }
});
