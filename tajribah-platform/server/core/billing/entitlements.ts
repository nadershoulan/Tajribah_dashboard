/**
 * P0.12 — plan entitlements and quotas.
 *
 * Two questions, answered in one place so no feature invents its own answer:
 *   "is this feature in the tenant's plan?"  → `hasFeature`
 *   "is there room for one more?"            → `assertWithinQuota`
 *
 * Quota checks read the live count rather than a counter wherever the count is cheap
 * (products, team members). A counter that drifts is worse than a query that is slightly
 * slower, because a drifted counter either blocks a paying merchant or gives away the plan.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import {
  LIMIT_KEY, planFeatures, planLimits, plans, products, subscriptions, tenantMemberships, usageCounters, models3d,
  type LimitKey,
} from '@/db/schema';
import { UNLIMITED, planByCode, type PlanCode, type PlanDefinition, type PlanLimits } from '@/lib/plans';
import { errors } from '../errors/problem';
import { log } from '../observability/log';
import type { TenantContext } from '../tenancy/context';

export type Entitlements = {
  plan: PlanDefinition;
  status: 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired' | 'none';
  /** False once a trial has lapsed or a subscription is cancelled — read-only mode. */
  canWrite: boolean;
  has(feature: string): boolean;
  limit(key: LimitKey): number;
};

/**
 * Resolve what a tenant is entitled to. A tenant with no subscription row is on the trial
 * of the Starter plan: the product is usable immediately after signup, which is what the
 * onboarding flow depends on.
 *
 * P2.1: limits and features are the plan's **rows** (`plan_limits`, `plan_features`, seeded
 * from lib/plans.ts by drizzle/0006), so a change made in the database — the admin console,
 * a support fix — applies on the next request without a deploy. Names and marketing copy
 * still come from lib/plans.ts. A limit with no row is 0 and a feature with no row is off:
 * a catalogue that is missing something refuses, it never gives the plan away.
 */
export async function entitlementsOf(ctx: TenantContext): Promise<Entitlements> {
  const db = unsafeAdminDb(); // subscription and catalogue are platform billing state
  const [found] = await db
    .select({ subscription: subscriptions, planId: plans.id, code: plans.code })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.tenantId, ctx.tenantId))
    .limit(1);
  const subscription = found?.subscription;

  const code: PlanCode = found?.code ?? 'starter';
  const planId = found?.planId
    ?? (await db.select({ id: plans.id }).from(plans).where(eq(plans.code, code)).limit(1))[0]?.id;
  if (!planId) log.error('plan catalogue is missing a plan — every limit reads as 0', { code });
  const [limitRows, featureRows] = planId
    ? await Promise.all([
      db.select().from(planLimits).where(eq(planLimits.planId, planId)),
      db.select().from(planFeatures).where(and(eq(planFeatures.planId, planId), eq(planFeatures.enabled, true))),
    ])
    : [[], []];
  const limits = new Map<LimitKey, number>(limitRows.map((row) => [row.key, row.value]));
  const features = new Set(featureRows.map((row) => row.featureKey));
  const plan: PlanDefinition = {
    ...planByCode(code),
    limits: Object.fromEntries(LIMIT_KEY.map((key) => [key, limits.get(key) ?? 0])) as PlanLimits,
    features: [...features],
  };
  const status = subscription?.status ?? (ctx.tenant.status === 'trial' ? 'trialing' : 'none');

  const trialOver = ctx.tenant.trialEndsAt ? ctx.tenant.trialEndsAt.getTime() < Date.now() : false;
  const canWrite = status === 'active'
    || (status === 'trialing' && !trialOver)
    || status === 'past_due'; // grace: dunning chases the payment, it does not lock the store

  return {
    plan,
    status,
    canWrite,
    has: (feature: string) => features.has(feature),
    limit: (key: LimitKey) => limits.get(key) ?? 0,
  };
}

/**
 * The plan each tenant is on, for summaries (the store switcher, `/me`). Same rule as
 * `entitlementsOf`: no subscription row means the Starter trial.
 */
export async function planCodesFor(tenantIds: readonly string[]): Promise<Map<string, PlanCode>> {
  const codes = new Map<string, PlanCode>(tenantIds.map((id) => [id, 'starter']));
  if (tenantIds.length === 0) return codes;
  const db = unsafeAdminDb(); // platform billing state, filtered to the caller's own tenants
  // Plan ids are uuids: the code lives on the plans row, never in the id.
  const rows = await db.select({ tenantId: subscriptions.tenantId, code: plans.code })
    .from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(inArray(subscriptions.tenantId, [...tenantIds]));
  for (const row of rows) codes.set(row.tenantId, row.code);
  return codes;
}

export function assertFeature(entitlements: Entitlements, feature: string): void {
  if (!entitlements.has(feature)) throw errors.planRequired(feature);
}

/** The live count for a metric, per tenant. */
export async function currentUsage(ctx: TenantContext, metric: LimitKey): Promise<number> {
  switch (metric) {
    case 'products':
      return ctx.db.count(products, isNull(products.deletedAt));
    case 'team_members': {
      const db = unsafeAdminDb();
      const rows = await db.select().from(tenantMemberships).where(and(
        eq(tenantMemberships.tenantId, ctx.tenantId),
        eq(tenantMemberships.status, 'active'),
      ));
      return rows.length;
    }
    case 'ai_credits':
    case 'ar_sessions':
    case 'storage_gb':
    case 'bandwidth_gb':
    default: {
      // Metered rather than counted: these accumulate over a billing period.
      const rows = await ctx.db.find(usageCounters, eq(usageCounters.metric, metric));
      const period = currentPeriodStart();
      return rows
        .filter((r) => r.periodStart.getTime() === period.getTime())
        .reduce((sum, r) => sum + r.value, 0);
    }
  }
}

/**
 * Refuse the action that would cross the limit, before it happens.
 *
 * The error names the metric and the limit, because "you have reached your plan limit" with
 * no number is the kind of message that generates a support ticket.
 */
export async function assertWithinQuota(
  ctx: TenantContext,
  metric: LimitKey,
  increment = 1,
): Promise<void> {
  const entitlements = await entitlementsOf(ctx);
  const limit = entitlements.limit(metric);
  if (limit === UNLIMITED) return;

  const used = await currentUsage(ctx, metric);
  if (used + increment > limit) throw errors.quota(metric, limit);
}

/** Record metered usage for the current period. Additive, so a retry over-counts — callers pass an idempotent delta. */
export async function recordUsage(ctx: TenantContext, metric: LimitKey, delta: number): Promise<void> {
  const period = currentPeriodStart();
  const existing = await ctx.db.findOne(usageCounters, and(
    eq(usageCounters.metric, metric),
    eq(usageCounters.periodStart, period),
  )!);

  if (existing) {
    await ctx.db.update(usageCounters, and(
      eq(usageCounters.metric, metric),
      eq(usageCounters.periodStart, period),
    )!, { value: existing.value + delta });
    return;
  }
  await ctx.db.insert(usageCounters, { metric, periodStart: period, value: delta } as never);
}

/** Calendar month in Asia/Riyadh — the billing period for metered usage. */
export function currentPeriodStart(now = new Date()): Date {
  const riyadh = new Date(now.getTime() + 3 * 60 * 60 * 1000); // UTC+3, no DST in KSA
  return new Date(Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), 1) - 3 * 60 * 60 * 1000);
}

/** A tenant's model count, used by the storage and QA screens. */
export async function modelCount(ctx: TenantContext): Promise<number> {
  return ctx.db.count(models3d);
}
