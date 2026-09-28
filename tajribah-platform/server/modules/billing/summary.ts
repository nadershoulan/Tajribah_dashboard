/**
 * P2.10 — the billing screen's data, from the database: the store's plan and status, prices
 * from the catalogue rows (P2.1), AI credits from the ledger (P2.9), invoices (P2.6).
 *
 * `paymentMethod` is null until the payment provider holds one (P2.3, Moyasar) — never a
 * placeholder card.
 */
import { subscriptions } from '@/db/schema';
import { implicitPlan } from '@/lib/plans';
import type { BillingSummary } from '@/lib/view-models';
import { planCatalogue } from '@/server/core/billing/entitlements';
import type { TenantContext } from '@/server/core/tenancy/context';
import { creditSummary } from './credits';
import { invoicesOf } from './invoices';

export async function billingSummary(ctx: TenantContext, now = new Date()): Promise<BillingSummary> {
  ctx.require('billing:read');
  const subscription = await ctx.db.findOne(subscriptions); // this store's, through its own scope
  const catalogue = await planCatalogue();
  const found = subscription ? { subscription, code: catalogue.find((p) => p.id === subscription.planId)?.code ?? 'starter' } : null;

  const code = found?.code ?? implicitPlan(ctx.tenant.status); // T35: a trial runs on Growth
  const cycle = found?.subscription.billingCycle ?? 'monthly';
  const row = catalogue.find((p) => p.code === code);
  const credits = await creditSummary(ctx, now);
  const invoices = await invoicesOf(ctx);

  return {
    plan: code,
    status: found?.subscription.status ?? (ctx.tenant.status === 'trial' ? 'trialing' : 'none'),
    cycle,
    renewsAt: found ? found.subscription.currentPeriodEnd.toISOString() : null,
    trialEndsAt: ctx.tenant.trialEndsAt?.toISOString() ?? null,
    priceMinor: (cycle === 'annual' ? row?.priceAnnualMinor : row?.priceMonthlyMinor) ?? null,
    currency: row?.currency ?? 'SAR',
    aiCredits: { balance: credits.balance, grantedThisPeriod: credits.grantedThisPeriod, usedThisPeriod: credits.usedThisPeriod },
    invoices,
    paymentMethod: null,
    catalogue: catalogue.filter((p) => p.isPublic).map((p) => ({ code: p.code, priceMonthlyMinor: p.priceMonthlyMinor, priceAnnualMinor: p.priceAnnualMinor })),
  };
}
