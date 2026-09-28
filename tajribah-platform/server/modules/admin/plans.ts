/**
 * A6 — plans and pricing, for staff (ADM-13/14): a plan's prices, limits and features.
 *
 * T19: a change applies to every store on the plan at once — `entitlementsOf` reads these rows
 * on every request, and the merchant's billing page and checkout read the prices from them. So
 * the screen says how many stores a change reaches before it is saved, and a change needs a
 * reason. A lowered limit deletes nothing: the next create over it is refused, as for any full
 * store (T19).
 *
 * The change and its staff-trail row (every field before and after) are one transaction, the
 * plan row locked. Only what differs is written; a save that changes nothing is refused.
 */
import { and, count, eq, inArray, isNull, not, notExists } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { LIMIT_KEY, PLAN_CODE, planFeatures, planLimits, plans, subscriptions, tenants, type LimitKey } from '@/db/schema';
import { FEATURE_LABELS, TRIAL_PLAN, UNLIMITED, type PlanCode } from '@/lib/plans';
import { errors } from '@/server/core/errors/problem';
import { staffLog, type StaffContext } from './access';

export const FEATURE_KEYS = Object.keys(FEATURE_LABELS);

const LIVE = ['trialing', 'active', 'past_due'] as const;

/**
 * How many stores a change to this plan reaches today: live subscriptions on it — and the stores
 * with no subscription that run on it: Growth for those on trial, Starter for the rest (T35).
 */
async function reachOf(db: Db, planId: string, code: PlanCode): Promise<number> {
  const [subscribed] = await db.select({ n: count() }).from(subscriptions)
    .where(and(eq(subscriptions.planId, planId), inArray(subscriptions.status, [...LIVE])));
  if (code !== 'starter' && code !== TRIAL_PLAN) return Number(subscribed?.n ?? 0);
  const onTrial = eq(tenants.status, 'trial');
  const [unsubscribed] = await db.select({ n: count() }).from(tenants)
    .where(and(isNull(tenants.deletedAt), code === TRIAL_PLAN ? onTrial : not(onTrial), notExists(db.select({ one: subscriptions.id }).from(subscriptions).where(eq(subscriptions.tenantId, tenants.id)))));
  return Number(subscribed?.n ?? 0) + Number(unsubscribed?.n ?? 0);
}

export type PlanTerms = {
  priceMonthlyMinor: number | null;
  priceAnnualMinor: number | null;
  limits: Record<LimitKey, number>;
  features: Record<string, boolean>;
};

export type AdminPlan = PlanTerms & {
  code: PlanCode; name: string; nameAr: string; currency: string; isPublic: boolean;
  /** The stores a change reaches today (`reachOf`). */
  subscribers: number;
};

/** ADM-13 — every plan, in pricing order, with its terms and how many stores it reaches. */
export async function plansForStaff(): Promise<AdminPlan[]> {
  const db = unsafeAdminDb(); // the catalogue is platform state (A1)
  const rows = (await db.select().from(plans)).sort((a, b) => a.sortOrder - b.sortOrder);
  const ids = rows.map((r) => r.id);
  const [limits, features] = ids.length ? await Promise.all([
    db.select().from(planLimits).where(inArray(planLimits.planId, ids)),
    db.select().from(planFeatures).where(inArray(planFeatures.planId, ids)),
  ]) : [[], []];
  const result: AdminPlan[] = [];
  for (const plan of rows) {
    result.push({
      code: plan.code, name: plan.name, nameAr: plan.nameAr, currency: plan.currency, isPublic: plan.isPublic,
      ...termsOf(plan, limits.filter((l) => l.planId === plan.id), features.filter((f) => f.planId === plan.id)),
      subscribers: await reachOf(db, plan.id, plan.code),
    });
  }
  return result;
}

function termsOf(
  plan: { priceMonthlyMinor: number | null; priceAnnualMinor: number | null },
  limits: { key: LimitKey; value: number }[],
  features: { featureKey: string; enabled: boolean }[],
): PlanTerms {
  return {
    priceMonthlyMinor: plan.priceMonthlyMinor,
    priceAnnualMinor: plan.priceAnnualMinor,
    // A missing row is 0 / off — exactly what `entitlementsOf` enforces (P2.1).
    limits: Object.fromEntries(LIMIT_KEY.map((key) => [key, limits.find((l) => l.key === key)?.value ?? 0])) as Record<LimitKey, number>,
    features: Object.fromEntries(FEATURE_KEYS.map((key) => [key, features.find((f) => f.featureKey === key)?.enabled ?? false])),
  };
}

export type PlanChange = {
  priceMonthlyMinor?: number | null;
  priceAnnualMinor?: number | null;
  limits?: Partial<Record<LimitKey, number>>;
  features?: Record<string, boolean>;
  reason: string;
};

const MAX_PRICE_MINOR = 100_000_000; // SAR 1,000,000 a month — past this it is a typo

function check(change: PlanChange, after: PlanTerms): void {
  const problems: Record<string, string[]> = {};
  for (const key of ['priceMonthlyMinor', 'priceAnnualMinor'] as const) {
    const v = after[key];
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > MAX_PRICE_MINOR)) problems[key] = ['a whole number of halalas, 0 or more'];
  }
  // Either both prices or neither ("talk to us"): a plan cannot be sold on one cycle only.
  if ((after.priceMonthlyMinor === null) !== (after.priceAnnualMinor === null)) problems.priceAnnualMinor = ['set both prices, or neither'];
  for (const [key, v] of Object.entries(change.limits ?? {})) {
    if (!(LIMIT_KEY as readonly string[]).includes(key)) problems[`limits.${key}`] = ['not a limit'];
    else if (!Number.isInteger(v) || v < UNLIMITED) problems[`limits.${key}`] = ['a whole number, 0 or more (or unlimited)'];
  }
  for (const key of Object.keys(change.features ?? {})) {
    if (!FEATURE_KEYS.includes(key)) problems[`features.${key}`] = ['not a feature'];
  }
  if (Object.keys(problems).length) throw errors.validation(problems);
}

/** ADM-14 — change a plan's terms, for every store on it (T19). Returns what changed. */
export async function updatePlan(staff: StaffContext, code: PlanCode, change: PlanChange): Promise<{ changed: string[] }> {
  const reason = change.reason.trim();
  if (reason.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  if (!(PLAN_CODE as readonly string[]).includes(code)) throw errors.notFound('plan');

  return unsafeAdminDb().transaction(async (tx) => {
    const [plan] = await tx.select().from(plans).where(eq(plans.code, code)).for('update');
    if (!plan) throw errors.notFound('plan');
    const before = termsOf(plan,
      await tx.select().from(planLimits).where(eq(planLimits.planId, plan.id)),
      await tx.select().from(planFeatures).where(eq(planFeatures.planId, plan.id)));
    const after: PlanTerms = {
      priceMonthlyMinor: change.priceMonthlyMinor !== undefined ? change.priceMonthlyMinor : before.priceMonthlyMinor,
      priceAnnualMinor: change.priceAnnualMinor !== undefined ? change.priceAnnualMinor : before.priceAnnualMinor,
      limits: { ...before.limits, ...change.limits },
      features: { ...before.features, ...change.features },
    };
    check(change, after);

    const changed: string[] = [];
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    const note = (field: string, from: unknown, to: unknown) => { if (from !== to) { changed.push(field); diff[field] = { from, to }; } };
    note('priceMonthlyMinor', before.priceMonthlyMinor, after.priceMonthlyMinor);
    note('priceAnnualMinor', before.priceAnnualMinor, after.priceAnnualMinor);
    for (const key of LIMIT_KEY) note(`limits.${key}`, before.limits[key], after.limits[key]);
    for (const key of FEATURE_KEYS) note(`features.${key}`, before.features[key], after.features[key]);
    if (changed.length === 0) throw errors.conflict('nothing changed');

    if (diff.priceMonthlyMinor || diff.priceAnnualMinor) {
      await tx.update(plans).set({ priceMonthlyMinor: after.priceMonthlyMinor, priceAnnualMinor: after.priceAnnualMinor, updatedAt: new Date() }).where(eq(plans.id, plan.id));
    }
    for (const key of LIMIT_KEY) {
      if (!diff[`limits.${key}`]) continue;
      await tx.insert(planLimits).values({ planId: plan.id, key, value: after.limits[key] })
        .onConflictDoUpdate({ target: [planLimits.planId, planLimits.key], set: { value: after.limits[key] } });
    }
    for (const key of FEATURE_KEYS) {
      if (!diff[`features.${key}`]) continue;
      await tx.insert(planFeatures).values({ planId: plan.id, featureKey: key, enabled: after.features[key]! })
        .onConflictDoUpdate({ target: [planFeatures.planId, planFeatures.featureKey], set: { enabled: after.features[key]! } });
    }
    const reach = await reachOf(tx as unknown as Db, plan.id, code);
    await staffLog(staff, { action: 'plan.update', targetType: 'plan', targetId: plan.id, reason, detail: { code, changes: diff, stores: reach } }, tx as unknown as Db);
    return { changed };
  });
}
