/**
 * P2.12 — coupons: the rules, the discount, the check at checkout, and redemption.
 *
 * Rules that are not style choices:
 *  - **Validated on the server**, every time: active, inside its dates, for this plan and
 *    cycle, not used up, not already used by this store. The screen shows the server's answer.
 *  - **A coupon is used once per store** (unique index on coupon + store) and never beyond its
 *    limit: redemption locks the coupon row, counts, and inserts in one transaction, so two
 *    stores redeeming the last use at once cannot both succeed.
 *  - A discount never takes a price below zero, and VAT is charged on what is left.
 *  - Free months apply to monthly billing only (an annual price is already discounted).
 *
 * The catalogue is platform data (read-only to the app role); counting another store's
 * redemptions is a cross-store read — so this module uses the admin handle, filtering
 * explicitly. Redemption at checkout is wired by the payment path (P2.4/P2.5).
 */
import { and, count, eq } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { couponRedemptions, coupons, type Coupon } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import type { Bi } from '@/lib/lang';
import { planByCode, type PlanCode } from '@/lib/plans';
import { planCatalogue } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import { LIMITS, rateLimiter } from '@/server/core/ratelimit/limiter';
import type { TenantContext } from '@/server/core/tenancy/context';

export type Cycle = 'monthly' | 'annual';

/** What a merchant types, as stored: upper case, no spaces. */
export const normaliseCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');

/** Why a coupon cannot be used here, or null. The same words the checkout shows. */
export function couponProblem(coupon: Coupon, input: { plan: PlanCode; cycle: Cycle; now: Date; redemptions: number; usedByStore: boolean }): string | null {
  if (!coupon.active) return 'this code is no longer active';
  if (coupon.validFrom && coupon.validFrom.getTime() > input.now.getTime()) return 'this code is not valid yet';
  if (coupon.validUntil && coupon.validUntil.getTime() <= input.now.getTime()) return 'this code has expired';
  if (coupon.appliesTo && !coupon.appliesTo.includes(input.plan)) return `this code is not for the ${planByCode(input.plan).name.en} plan`;
  if (coupon.kind === 'free_months' && input.cycle !== 'monthly') return 'free months apply to monthly billing';
  if (input.usedByStore) return 'your store has already used this code';
  if (coupon.maxRedemptions != null && input.redemptions >= coupon.maxRedemptions) return 'this code has been used up';
  return null;
}

/** The discount on one period's price (halalas), and any free months. Never below zero. */
export function discountOf(coupon: Coupon, unitMinor: number): { discountMinor: number; freeMonths: number } {
  switch (coupon.kind) {
    case 'percent': return { discountMinor: Math.min(unitMinor, Math.floor((unitMinor * (coupon.percentOff ?? 0) + 50) / 100)), freeMonths: 0 };
    case 'fixed': return { discountMinor: Math.min(unitMinor, coupon.amountOffMinor ?? 0), freeMonths: 0 };
    case 'free_months': return { discountMinor: 0, freeMonths: coupon.freeMonths ?? 0 };
  }
}

export type CouponCheck = {
  couponId: string;
  code: string;
  kind: Coupon['kind'];
  discountMinor: number;
  freeMonths: number;
  description: Bi;
};

async function load(code: string): Promise<{ coupon: Coupon; redemptions: number } | null> {
  const db = unsafeAdminDb();
  const [coupon] = await db.select().from(coupons).where(eq(coupons.code, normaliseCode(code))).limit(1);
  if (!coupon) return null;
  const [{ n }] = await db.select({ n: count() }).from(couponRedemptions).where(eq(couponRedemptions.couponId, coupon.id));
  return { coupon, redemptions: Number(n) };
}

const describe = (c: Coupon, check: { discountMinor: number; freeMonths: number }): Bi =>
  c.kind === 'free_months'
    ? { ar: `${check.freeMonths} أشهر مجانًا`, en: `${check.freeMonths} free months` }
    : c.kind === 'percent'
      ? { ar: `خصم ${c.percentOff}%`, en: `${c.percentOff}% off` }
      : { ar: 'خصم ثابت', en: 'A fixed discount' };

/**
 * The checkout's question: may this store use this code for this plan and cycle, and what
 * does it take off? Refusals are 422 on `code`, one message for an unknown code. Rate limited
 * per store, so codes cannot be guessed at speed.
 */
export async function checkCoupon(ctx: TenantContext, input: { code: string; plan: PlanCode; cycle: Cycle }, now = new Date()): Promise<CouponCheck> {
  ctx.require('billing:write');
  const limit = await rateLimiter().hit(`coupon:${ctx.tenantId}`, LIMITS.couponCheck.limit, LIMITS.couponCheck.windowSeconds);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);

  const found = await load(input.code);
  if (!found) throw errors.validation({ code: ['this code is not valid'] });
  const usedByStore = (await unsafeAdminDb().select({ id: couponRedemptions.id }).from(couponRedemptions)
    .where(and(eq(couponRedemptions.couponId, found.coupon.id), eq(couponRedemptions.tenantId, ctx.tenantId))).limit(1)).length > 0;
  const problem = couponProblem(found.coupon, { ...input, now, redemptions: found.redemptions, usedByStore });
  if (problem) throw errors.validation({ code: [problem] });

  const prices = (await planCatalogue()).find((p) => p.code === input.plan);
  const unit = input.cycle === 'annual' ? prices?.priceAnnualMinor : prices?.priceMonthlyMinor;
  if (unit == null) throw errors.validation({ plan: ['this plan has no list price'] });
  const discount = discountOf(found.coupon, unit);
  return { couponId: found.coupon.id, code: found.coupon.code, kind: found.coupon.kind, ...discount, description: describe(found.coupon, discount) };
}

/**
 * Use a coupon for this store — called inside the payment path once the charge succeeded
 * (P2.4/P2.5). Locks the coupon row, re-checks, counts and records in one transaction.
 */
export async function redeemCoupon(
  ctx: TenantContext, input: { code: string; plan: PlanCode; cycle: Cycle; subscriptionId?: string | null; invoiceId?: string | null; discountMinor: number },
  now = new Date(),
): Promise<string> {
  ctx.require('billing:write');
  return unsafeAdminDb().transaction(async (tx) => {
    const [coupon] = await tx.select().from(coupons).where(eq(coupons.code, normaliseCode(input.code))).for('update').limit(1);
    if (!coupon) throw errors.validation({ code: ['this code is not valid'] });
    const [{ n }] = await tx.select({ n: count() }).from(couponRedemptions).where(eq(couponRedemptions.couponId, coupon.id));
    const usedByStore = (await tx.select({ id: couponRedemptions.id }).from(couponRedemptions)
      .where(and(eq(couponRedemptions.couponId, coupon.id), eq(couponRedemptions.tenantId, ctx.tenantId))).limit(1)).length > 0;
    const problem = couponProblem(coupon, { plan: input.plan, cycle: input.cycle, now, redemptions: Number(n), usedByStore });
    if (problem) throw errors.conflict(problem);
    const id = uuidv7();
    await tx.insert(couponRedemptions).values({
      id, tenantId: ctx.tenantId, couponId: coupon.id, subscriptionId: input.subscriptionId ?? null,
      invoiceId: input.invoiceId ?? null, discountMinor: input.discountMinor,
    });
    return id;
  });
}
