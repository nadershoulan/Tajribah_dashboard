/**
 * A2 — the platform at a glance (ADM-02), for staff. Read-only; every figure from the database.
 *
 *  - **MRR** is each paying subscription's list price per month from the plan rows (annual ÷ 12,
 *    rounded to the halala), over `active` and `past_due` subscriptions. Until payments run
 *    (P2.3) it is what the subscriptions are *worth*, not money received — the screen says so.
 *  - A store is **read-only** by the same rule the request context enforces (P2.11).
 *  - Churn: subscriptions cancelled in the last 30 days.
 */
import { and, count, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { creditLedger, invoices, plans, subscriptions, tenants } from '@/db/schema';
import type { PlanCode } from '@/lib/plans';
import { currentPeriodStart, nextPeriodStart } from '@/server/core/billing/entitlements';
import { writeStateOf } from '@/server/core/billing/lifecycle';

const DAY = 86_400_000;

export type PlatformOverview = {
  stores: { total: number; trial: number; active: number; pastDue: number; suspended: number; cancelled: number; readOnly: number };
  newStores30d: number;
  trialsEndingIn7d: number;
  subscriptionsByPlan: Record<PlanCode, number>;
  mrrMinor: number;
  arrMinor: number;
  churn30d: number;
  invoicesThisMonth: { count: number; totalMinor: number };
  aiCreditsUsedThisMonth: number;
  asOf: string;
};

export async function platformOverview(now = new Date()): Promise<PlatformOverview> {
  const db = unsafeAdminDb(); // staff read across every store (A1)
  const stores = await db.select({ id: tenants.id, status: tenants.status, trialEndsAt: tenants.trialEndsAt, createdAt: tenants.createdAt })
    .from(tenants).where(sql`${tenants.deletedAt} is null`);
  const subs = await db.select({ tenantId: subscriptions.tenantId, status: subscriptions.status, cycle: subscriptions.billingCycle, cancelledAt: subscriptions.cancelledAt, code: plans.code, monthly: plans.priceMonthlyMinor, annual: plans.priceAnnualMinor })
    .from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId));
  const subOf = new Map(subs.map((s) => [s.tenantId, s]));

  const byStatus = (status: string) => stores.filter((s) => s.status === status).length;
  const readOnly = stores.filter((s) => writeStateOf({ subscriptionStatus: subOf.get(s.id)?.status ?? null, trialEndsAt: s.trialEndsAt, now }).readOnly !== null).length;
  const paying = subs.filter((s) => s.status === 'active' || s.status === 'past_due');
  const mrrMinor = paying.reduce((sum, s) => sum + (s.cycle === 'annual' ? Math.round((s.annual ?? 0) / 12) : (s.monthly ?? 0)), 0);
  const subscriptionsByPlan = { starter: 0, growth: 0, pro: 0, enterprise: 0 } as Record<PlanCode, number>;
  for (const s of paying) subscriptionsByPlan[s.code] += 1;

  const from = currentPeriodStart(now);
  const to = nextPeriodStart(now);
  const [issued] = await db.select({ n: count(), total: sql<string>`coalesce(sum(${invoices.totalMinor}), 0)` })
    .from(invoices).where(and(gte(invoices.issuedAt, from), lt(invoices.issuedAt, to), inArray(invoices.status, ['issued', 'paid'])));
  const [credits] = await db.select({ used: sql<string>`coalesce(-sum(${creditLedger.delta}), 0)` })
    .from(creditLedger).where(and(inArray(creditLedger.reason, ['consumption', 'refund']), gte(creditLedger.createdAt, from), lt(creditLedger.createdAt, to)));

  return {
    stores: {
      total: stores.length, trial: byStatus('trial'), active: byStatus('active'), pastDue: byStatus('past_due'),
      suspended: byStatus('suspended'), cancelled: byStatus('cancelled'), readOnly,
    },
    newStores30d: stores.filter((s) => s.createdAt.getTime() > now.getTime() - 30 * DAY).length,
    trialsEndingIn7d: stores.filter((s) => !subOf.get(s.id) && s.trialEndsAt && s.trialEndsAt.getTime() > now.getTime() && s.trialEndsAt.getTime() <= now.getTime() + 7 * DAY).length,
    subscriptionsByPlan,
    mrrMinor,
    arrMinor: mrrMinor * 12,
    churn30d: subs.filter((s) => s.cancelledAt && s.cancelledAt.getTime() > now.getTime() - 30 * DAY).length,
    invoicesThisMonth: { count: Number(issued.n), totalMinor: Number(issued.total) },
    aiCreditsUsedThisMonth: Math.max(0, Number(credits.used)),
    asOf: now.toISOString(),
  };
}
