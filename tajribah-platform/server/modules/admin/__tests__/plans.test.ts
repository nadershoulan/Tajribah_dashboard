/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A6 — staff change a plan's prices, limits and features; every store on it gets the new terms
 * at once (T19), including the trial stores with no subscription (they run on Starter).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { planLimits, staffAudit, subscriptions, tenants } from '@/db/schema';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, seededPlanId } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { plansForStaff, updatePlan } from '@/server/modules/admin/plans';
import { billingSummary } from '@/server/modules/billing/summary';

setLogLevel('error');
const STAFF = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });

test('the plans: pricing order, the seeded terms, and how many stores each one reaches', async () => {
  const harness = await createTestDb();
  try {
    const trial = await seedTenant(harness, 'alpha'); // no subscription: the Starter trial
    const paying = await seedTenant(harness, 'bravo');
    const gone = await seedTenant(harness, 'charlie');
    const lapsed = await seedTenant(harness, 'delta');
    const growth = await seededPlanId(harness, 'growth');
    const now = new Date();
    await harness.asAdmin(async () => {
      await harness.db.insert(subscriptions).values([
        { tenantId: paying.tenantId, planId: growth, status: 'active', currentPeriodStart: now, currentPeriodEnd: now },
        { tenantId: lapsed.tenantId, planId: growth, status: 'cancelled', currentPeriodStart: now, currentPeriodEnd: now },
      ] as any);
      await harness.db.update(tenants).set({ deletedAt: now }).where(eq(tenants.id, gone.tenantId));
    });

    const all = await plansForStaff();
    assert.deepEqual(all.map((p) => p.code), ['starter', 'growth', 'pro', 'enterprise']);
    const starter = all[0]!;
    assert.deepEqual([starter.priceMonthlyMinor, starter.priceAnnualMinor, starter.limits.products, starter.features.ar_viewer, starter.features.salla], [9900, 99000, 20, true, false]);
    assert.deepEqual(all.map((p) => p.subscribers), [1, 1, 0, 0], 'Starter: the trial store (not the deleted one); Growth: the paying store, not the cancelled one');
    assert.equal(all[3]!.priceMonthlyMinor, null, 'Enterprise has no list price');
    void trial;
  } finally { await harness.close(); }
});

test('a change reaches every store on the plan at once: limits, features, the price on the billing page; audited field by field', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const staff = STAFF(store.userId);
    const merchant = () => buildTenantContext({ actor: { userId: store.userId, email: store.email, isStaff: false }, tenantId: store.tenantId, requestId: 'r' });
    assert.equal((await entitlementsOf(await merchant())).limit('products'), 20);

    const result = await updatePlan(staff, 'starter', {
      priceMonthlyMinor: 12900, priceAnnualMinor: 129000, limits: { products: 30, ai_credits: 5 }, features: { salla: true, ar_viewer: true },
      reason: 'new pricing from October',
    });
    assert.deepEqual(result.changed, ['priceMonthlyMinor', 'priceAnnualMinor', 'limits.products', 'features.salla'], 'only what differs');

    const ent = await entitlementsOf(await merchant());
    assert.equal(ent.limit('products'), 30, 'the trial store has the new limit on its next request');
    assert.ok(ent.has('salla'));
    const summary = await billingSummary(await merchant());
    assert.equal(summary.catalogue.find((p) => p.code === 'starter')!.priceMonthlyMinor, 12900, 'the billing page and checkout price');

    const [row] = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.equal(row!.action, 'plan.update');
    assert.equal(row!.reason, 'new pricing from October');
    assert.deepEqual((row!.detail as any).changes['limits.products'], { from: 20, to: 30 });
    assert.equal((row!.detail as any).stores, 1);

    await assert.rejects(() => updatePlan(staff, 'starter', { limits: { products: 30 }, reason: 'same again' }), (e: any) => e.code === 'conflict', 'nothing changed');
    await assert.rejects(() => updatePlan(staff, 'starter', { limits: { products: 31 }, reason: 'no' }), (e: any) => e.code === 'validation_failed', 'a reason');
    const invalid = async (change: any) => assert.rejects(() => updatePlan(staff, 'starter', { reason: 'bad input test', ...change }), (e: any) => e.code === 'validation_failed');
    await invalid({ priceMonthlyMinor: -1 });
    await invalid({ priceMonthlyMinor: 99.5 });
    await invalid({ priceAnnualMinor: null });
    await invalid({ limits: { products: -2 } });
    await invalid({ limits: { seats: 3 } });
    await invalid({ features: { teleport: true } });
    await assert.rejects(() => updatePlan(staff, 'nope' as any, { limits: { products: 1 }, reason: 'no such plan' }), (e: any) => e.code === 'not_found');
    assert.equal((await harness.asAdmin(() => harness.db.select().from(staffAudit))).length, 1, 'refusals change nothing and log nothing');
    assert.equal((await plansForStaff())[0]!.limits.products, 30);

    // Unlimited, and "talk to us" (both prices off together).
    await updatePlan(staff, 'growth', { limits: { products: -1 }, priceMonthlyMinor: null, priceAnnualMinor: null, reason: 'sales-led for now' });
    const growth = (await plansForStaff())[1]!;
    assert.deepEqual([growth.limits.products, growth.priceMonthlyMinor, growth.priceAnnualMinor], [-1, null, null]);
  } finally { await harness.close(); }
});

test('a missing limit row reads as 0 (as entitlements enforce it) and a change writes it', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const pro = await seededPlanId(harness, 'pro');
    await harness.asAdmin(() => harness.db.delete(planLimits).where(and(eq(planLimits.planId, pro), eq(planLimits.key, 'bandwidth_gb'))));
    assert.equal((await plansForStaff())[2]!.limits.bandwidth_gb, 0);
    await updatePlan(STAFF(store.userId), 'pro', { limits: { bandwidth_gb: 2000 }, reason: 'row was missing' });
    assert.equal((await plansForStaff())[2]!.limits.bandwidth_gb, 2000);
  } finally { await harness.close(); }
});
