/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P2.10 — the billing screen reads the database: plan and status, prices from the plan rows,
 * AI credits from the ledger, the store's invoices; no invented payment method.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { plans, subscriptions, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { SELLER } from '@/server/core/billing/seller';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import { issueInvoice } from '@/server/modules/billing/invoices';
import { billingSummary } from '@/server/modules/billing/summary';

setLogLevel('error');
const NOW = new Date('2026-10-05T09:00:00Z');

async function store(harness: TestDb, name: string, role: 'owner' | 'editor' = 'owner') {
  const seeded = await seedTenant(harness, name);
  let userId = seeded.userId;
  if (role !== 'owner') {
    userId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: userId, email: `${role}-${name}@example.test`, passwordHash: 'x', fullName: role } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: seeded.tenantId, userId, role, status: 'active' } as any);
    });
  }
  const ctx = await buildTenantContext({ actor: { userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

test('a store on its trial: the Starter plan, its price and credits from the database, no invoices, no payment method', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const summary = await billingSummary(ctx, NOW);
    assert.deepEqual([summary.plan, summary.cycle, summary.priceMinor, summary.currency], ['starter', 'monthly', 9900, 'SAR']);
    assert.deepEqual(summary.aiCredits, { balance: 5, grantedThisPeriod: 5, usedThisPeriod: 0 }, 'the ledger’s grant');
    assert.deepEqual([summary.invoices, summary.paymentMethod], [[], null]);
    assert.deepEqual(summary.catalogue.map((p) => [p.code, p.priceMonthlyMinor]), [['starter', 9900], ['growth', 29900], ['pro', 99900], ['enterprise', null]]);

    // A price changed in the database is what the screen (and the checkout quote) shows.
    const starter = await seededPlanId(harness, 'starter');
    await harness.asAdmin(() => harness.db.update(plans).set({ priceMonthlyMinor: 11900 }).where(eq(plans.id, starter)));
    assert.equal((await billingSummary(ctx, NOW)).priceMinor, 11900);
  } finally { await harness.close(); }
});

test('a subscribed store: its plan, cycle, annual price and renewal; its invoices, newest first, not another store’s', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const other = await store(harness, 'bravo');
    const growth = await seededPlanId(harness, 'growth');
    const end = new Date('2027-10-05T09:00:00Z');
    await harness.asAdmin(() => harness.db.insert(subscriptions).values({
      tenantId, planId: growth, status: 'active', billingCycle: 'annual', currentPeriodStart: NOW, currentPeriodEnd: end,
    } as any));
    const seller = { ...SELLER, vatNumber: '300000000000003' };
    const lines = [{ description: 'Growth — annual', descriptionAr: 'النمو — سنوي', quantity: 1, unitPriceMinor: 299_000 }];
    const mine = await issueInvoice(ctx, { lines, paid: true, issuedAt: NOW }, seller);
    await issueInvoice(other.ctx, { lines, paid: true, issuedAt: NOW }, seller);

    const summary = await billingSummary(ctx, NOW);
    assert.deepEqual([summary.plan, summary.status, summary.cycle, summary.priceMinor, summary.renewsAt], ['growth', 'active', 'annual', 299_000, end.toISOString()]);
    assert.equal(summary.aiCredits.grantedThisPeriod, 40, 'Growth’s monthly credits');
    assert.deepEqual(summary.invoices.map((i) => [i.number, i.totalMinor, i.status, i.zatcaStatus]), [[mine.number, 343_850, 'paid', null]]);
  } finally { await harness.close(); }
});

test('billing is for owners and admins', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha', 'editor');
    await assert.rejects(() => billingSummary(ctx, NOW), (e: any) => e.code === 'forbidden');
  } finally { await harness.close(); }
});
