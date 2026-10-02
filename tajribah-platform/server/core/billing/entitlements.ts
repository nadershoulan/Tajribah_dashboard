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
import { and, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { creditLedger, dailyTenantStats, generationPhotos, LIMIT_KEY, modelFiles, models3d, planFeatures, planLimits, plans, products, subscriptions, tenantMemberships, tenants, tryonConfigs, type LimitKey, usageCounters } from '@/db/schema';
import { UNLIMITED, implicitPlan, planByCode, type PlanCode, type PlanDefinition, type PlanLimits } from '@/lib/plans';
import { errors } from '../errors/problem';
import { log } from '../observability/log';
import { writeStateOf, type ReadOnlyReason } from './lifecycle';
import type { TenantContext } from '../tenancy/context';
import type { TenantDb } from '../tenancy/tenant-db';

export type Entitlements = {
  plan: PlanDefinition;
  status: 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired' | 'none';
  /** False once a trial has lapsed or a subscription is cancelled — read-only mode. */
  canWrite: boolean;
  has(feature: string): boolean;
  limit(key: LimitKey): number;
};

/**
 * Resolve what a tenant is entitled to. A tenant with no subscription row is on the trial, which
 * runs on **Growth**'s features (T35 — catalogue sync included, so setup works as designed); one
 * with no subscription that is not on trial is on Starter (`implicitPlan`).
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

  const code: PlanCode = found?.code ?? implicitPlan(ctx.tenant.status); // T35: a trial runs on Growth
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

  // P2.11: the same rule the request context enforces (server/core/billing/lifecycle.ts).
  const canWrite = writeStateOf({ subscriptionStatus: subscription?.status ?? null, trialEndsAt: ctx.tenant.trialEndsAt }).readOnly === null;

  return {
    plan,
    status,
    canWrite,
    has: (feature: string) => features.has(feature),
    limit: (key: LimitKey) => limits.get(key) ?? 0,
  };
}

/**
 * P8 — whether a store's plan has `feature`, from the store row alone (the request context asks
 * this before a context exists, and only for a member holding a custom role). Same rule as
 * `entitlementsOf`: its subscription's plan, else the trial's while on trial, else Starter.
 */
export async function planHasFeature(tenant: { id: string; status: string }, feature: string): Promise<boolean> {
  const db = unsafeAdminDb(); // platform billing state, for this one store
  const [found] = await db.select({ planId: subscriptions.planId }).from(subscriptions).where(eq(subscriptions.tenantId, tenant.id)).limit(1);
  const planId = found?.planId
    ?? (await db.select({ id: plans.id }).from(plans).where(eq(plans.code, implicitPlan(tenant.status))).limit(1))[0]?.id;
  if (!planId) return false;
  const [row] = await db.select({ key: planFeatures.featureKey }).from(planFeatures)
    .where(and(eq(planFeatures.planId, planId), eq(planFeatures.featureKey, feature), eq(planFeatures.enabled, true))).limit(1);
  return !!row;
}

/**
 * The plan each tenant is on, for summaries (the store switcher, `/me`). Same rule as
 * `entitlementsOf`: no subscription row means the trial's plan while on trial, else Starter.
 */
export async function planCodesFor(tenantIds: readonly string[]): Promise<Map<string, PlanCode>> {
  const codes = new Map<string, PlanCode>();
  if (tenantIds.length === 0) return codes;
  const db = unsafeAdminDb(); // platform billing state, filtered to the caller's own tenants
  for (const t of await db.select({ id: tenants.id, status: tenants.status }).from(tenants).where(inArray(tenants.id, [...tenantIds]))) codes.set(t.id, implicitPlan(t.status));
  // Plan ids are uuids: the code lives on the plans row, never in the id.
  const rows = await db.select({ tenantId: subscriptions.tenantId, code: plans.code })
    .from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(inArray(subscriptions.tenantId, [...tenantIds]));
  for (const row of rows) codes.set(row.tenantId, row.code);
  return codes;
}

/** P2.10: the public plan rows (prices included), in pricing order — the catalogue is platform state. */
export async function planCatalogue(): Promise<(typeof plans.$inferSelect)[]> {
  const rows = await unsafeAdminDb().select().from(plans);
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** P2.11: why each store is read-only (or null), for the session — the same rule as the request context. */
export async function readOnlyFor(stores: readonly { id: string; trialEndsAt: Date | null }[], now = new Date()): Promise<Map<string, ReadOnlyReason | null>> {
  const result = new Map<string, ReadOnlyReason | null>();
  if (stores.length === 0) return result;
  const rows = await unsafeAdminDb().select({ tenantId: subscriptions.tenantId, status: subscriptions.status })
    .from(subscriptions).where(inArray(subscriptions.tenantId, stores.map((s) => s.id)));
  const status = new Map(rows.map((r) => [r.tenantId, r.status]));
  for (const store of stores) {
    result.set(store.id, writeStateOf({ subscriptionStatus: status.get(store.id) ?? null, trialEndsAt: store.trialEndsAt, now }).readOnly);
  }
  return result;
}

export function assertFeature(entitlements: Entitlements, feature: string): void {
  if (!entitlements.has(feature)) throw errors.planRequired(feature);
}

/** Storage limits are in GiB (1024³ bytes) — the generous reading of "2 GB" for the merchant. */
export const BYTES_PER_GB = 1024 ** 3;

/**
 * P2.2 — what a store has used, in the limit's own unit. Every metric has **one** source, and
 * each source is idempotent by construction, so a retried event can never be counted twice
 * and two concurrent writers can never lose one:
 *
 *  - products, team members, storage: **live**, from the rows themselves. Storage is the bytes
 *    held now (files whose bytes were not deleted), not an amount that accumulates per month.
 *  - AR sessions: the days of the analytics rollup in this Riyadh month. The rollup rewrites
 *    a whole day, so a replay writes the same number; the home screen reads this same figure.
 *  - bandwidth: a per-day total the CDN reports and `reportDailyBandwidth` *sets* (never adds).
 *  - AI credits: this month's use, from the credit ledger (P2.9).
 */
export async function currentUsage(ctx: TenantContext, metric: LimitKey, now = new Date()): Promise<number> {
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
    case 'storage_gb':
      return (await storageBytesHeld(ctx)) / BYTES_PER_GB;
    case 'ar_sessions': {
      const { first, next } = periodDays(now);
      const days = await ctx.db.find(dailyTenantStats, and(gte(dailyTenantStats.day, first), lt(dailyTenantStats.day, next)), { limit: 40 });
      return days.reduce((sum, day) => sum + day.arSessions, 0);
    }
    case 'ai_credits':
      return creditsUsedIn(ctx.db, currentPeriodStart(now), nextPeriodStart(now));
    case 'bandwidth_gb':
    default: {
      const start = currentPeriodStart(now);
      const rows = await ctx.db.find(usageCounters, and(
        eq(usageCounters.metric, metric),
        gte(usageCounters.periodStart, start),
        lt(usageCounters.periodStart, nextPeriodStart(now)),
      ), { limit: 40 });
      const total = rows.reduce((sum, r) => sum + r.value, 0);
      return metric === 'bandwidth_gb' ? total / 1024 : total; // bandwidth rows are MB per day
    }
  }
}

/**
 * P2.9: AI credits used between `from` and `to`, from the credit ledger: what was spent, less
 * what was refunded, never below zero. One definition for the quota, the home screen and the
 * ledger's own expiry.
 */
export async function creditsUsedIn(db: TenantDb, from: Date, to: Date): Promise<number> {
  const rows = await db.find(creditLedger, and(
    inArray(creditLedger.reason, ['consumption', 'refund']), gte(creditLedger.createdAt, from), lt(creditLedger.createdAt, to),
  ), { limit: 10_000 });
  return Math.max(0, -rows.reduce((sum, r) => sum + r.delta, 0));
}

/**
 * Bytes this store holds in storage: every model file and every product photo (P3.3) whose
 * bytes were not deleted. A photo still uploading counts at the size it declared, so parallel
 * uploads cannot overrun the limit.
 */
export async function storageBytesHeld(ctx: TenantContext): Promise<number> {
  const files = await ctx.db.find(modelFiles, isNull(modelFiles.bytesDeletedAt), { limit: 100_000 });
  const photos = await ctx.db.find(generationPhotos, isNull(generationPhotos.bytesDeletedAt), { limit: 100_000 });
  const tryon = await ctx.db.find(tryonConfigs, undefined, { limit: 100_000 }); // P5.10: watch cut-outs
  const pictures = await ctx.db.find(models3d, isNotNull(models3d.pictureKey), { limit: 100_000 }); // P3.8: models' pictures
  return files.reduce((sum, file) => sum + file.fileSizeBytes, 0) + photos.reduce((sum, photo) => sum + (photo.sizeBytes ?? 0), 0)
    + tryon.reduce((sum, c) => sum + (c.wornBytes ?? 0) + (c.flatBytes ?? 0), 0)
    + pictures.reduce((sum, m) => sum + (m.pictureBytes ?? 0), 0);
}

/**
 * Refuse an upload that would take the store over its storage limit, before a byte is sent
 * (filed under P1.12: there was no check at all).
 */
export async function assertStorageRoom(ctx: TenantContext, incomingBytes: number): Promise<void> {
  const limit = (await entitlementsOf(ctx)).limit('storage_gb');
  if (limit === UNLIMITED) return;
  if ((await storageBytesHeld(ctx)) + incomingBytes > limit * BYTES_PER_GB) throw errors.quota('storage_gb', limit);
}

/**
 * The CDN's bandwidth for one Riyadh day, in MB. **Set, not added**: reporting the same day
 * again — a retry, a re-run of the import — writes the same number, and a later, more complete
 * report replaces an earlier one. One statement, so concurrent reports cannot interleave.
 */
export async function reportDailyBandwidth(ctx: TenantContext, day: string, megabytes: number): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`not a day: ${day}`);
  if (!Number.isInteger(megabytes) || megabytes < 0) throw new Error(`not a whole number of MB: ${megabytes}`);
  const periodStart = new Date(`${day}T00:00:00+03:00`);
  await ctx.db.upsert(
    usageCounters,
    { metric: 'bandwidth_gb', periodStart, value: megabytes } as never,
    [usageCounters.tenantId, usageCounters.periodStart, usageCounters.metric],
    { value: megabytes } as never,
  );
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

/** Calendar month in Asia/Riyadh — the billing period for metered usage. */
export function currentPeriodStart(now = new Date()): Date {
  const riyadh = new Date(now.getTime() + 3 * 60 * 60 * 1000); // UTC+3, no DST in KSA
  return new Date(Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), 1) - 3 * 60 * 60 * 1000);
}

/** The first instant of next month in Asia/Riyadh. */
export function nextPeriodStart(now = new Date()): Date {
  const riyadh = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth() + 1, 1) - 3 * 60 * 60 * 1000);
}

/** This Riyadh month as `date` strings: `first` included, `next` (next month's 1st) excluded. */
function periodDays(now: Date): { first: string; next: string } {
  const day = (d: Date) => new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { first: day(currentPeriodStart(now)), next: day(nextPeriodStart(now)) };
}

/** A tenant's model count, used by the storage and QA screens. */
export async function modelCount(ctx: TenantContext): Promise<number> {
  return ctx.db.count(models3d);
}
