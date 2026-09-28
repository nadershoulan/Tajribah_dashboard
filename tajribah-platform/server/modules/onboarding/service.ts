/**
 * P1.1 — onboarding: gather the facts, evaluate the checklist, record skips.
 *
 * Every read goes through `ctx.db` (tenant-scoped); every change goes through
 * `auditedUpdate`, so "who skipped connecting Salla, and when" is in the store's trail.
 */
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  analyticsEvents, edgeConfigs, models3d, products, storeConnections, subscriptions, tenants, tryonConfigs,
  type OnboardingState,
} from '@/db/schema';
import { auditedUpdate } from '@/server/core/audit/audit';
import { errors, isUniqueViolation } from '@/server/core/errors/problem';
import { slugProblem } from '@/lib/slug';
import type { TenantContext } from '@/server/core/tenancy/context';
import {
  OnboardingError, confirmStore, evaluate, skip, unskip,
  type Facts, type OnboardingView, type StepKey,
} from './machine';

/** One indexed existence check per fact — cheap enough to run on every dashboard load. */
export async function factsFor(ctx: TenantContext): Promise<Facts> {
  const tenant = await ctx.db.requireById(tenants, ctx.tenantId);
  const [hasPlan, hasActiveConnection, hasSizedProduct, hasReadyModel, hasReadyTryOn, hasLiveConfig, widgetSeen] = await Promise.all([
    ctx.db.exists(subscriptions),
    ctx.db.exists(storeConnections, eq(storeConnections.status, 'active')),
    // Width and height in millimetres are what make "real size" real; depth is optional.
    ctx.db.exists(products, and(
      eq(products.status, 'active'),
      isNull(products.deletedAt),
      sql`(${products.dimensions}->>'widthMm') is not null`,
      sql`(${products.dimensions}->>'heightMm') is not null`,
    )),
    ctx.db.exists(models3d, eq(models3d.status, 'ready')),
    // T38: a watch set up for the try-on — switched on, which needs both pictures and the case width.
    ctx.db.exists(tryonConfigs, and(eq(tryonConfigs.enabled, true), isNotNull(tryonConfigs.wornKey), isNotNull(tryonConfigs.flatKey), isNotNull(tryonConfigs.caseTenthsMm))),
    // T38: a product's button is live on the shop (P1.15).
    ctx.db.exists(edgeConfigs, and(isNotNull(edgeConfigs.key), isNull(edgeConfigs.withdrawnAt))),
    // The widget reports a product view from the live storefront: the install worked.
    ctx.db.exists(analyticsEvents, eq(analyticsEvents.eventType, 'product_view')),
  ]);
  return {
    storeConfirmed: tenant.onboardingState?.completedSteps?.includes('store') ?? false,
    hasPlan, hasActiveConnection, hasSizedProduct, hasReadyModel, hasReadyTryOn, hasLiveConfig, widgetSeen,
  };
}

export async function onboardingOf(ctx: TenantContext): Promise<OnboardingView> {
  const tenant = await ctx.db.requireById(tenants, ctx.tenantId);
  return evaluate(await factsFor(ctx), tenant.onboardingState);
}

type Change = (state: OnboardingState | null | undefined, facts: Facts) => OnboardingState;

async function change(ctx: TenantContext, apply: Change, extra: Partial<typeof tenants.$inferInsert> = {}): Promise<OnboardingView> {
  ctx.require('settings:write');
  const tenant = await ctx.db.requireById(tenants, ctx.tenantId);
  const facts = await factsFor(ctx);
  let next: OnboardingState;
  try {
    next = apply(tenant.onboardingState, facts);
  } catch (error) {
    if (error instanceof OnboardingError) throw errors.validation({ step: [error.message] });
    throw error;
  }
  try {
    await auditedUpdate(ctx, tenants, ctx.tenantId, { ...extra, onboardingState: next }, { resourceType: 'onboarding' });
  } catch (error) {
    if (isUniqueViolation(error)) throw errors.validation({ slug: ['this address is taken'] });
    throw error;
  }
  // `storeConfirmed` is the one fact read from the state just written — not the stale read.
  return evaluate({ ...facts, storeConfirmed: next.completedSteps.includes('store') }, next);
}

export const skipStep = (ctx: TenantContext, step: StepKey) => change(ctx, (s, f) => skip(s, step, f));
export const unskipStep = (ctx: TenantContext, step: StepKey) => change(ctx, (s, f) => unskip(s, step, f));

/**
 * P1.2 — the merchant confirms the store, and may choose its address (slug) while doing so.
 * The address is in the embed snippet, so it can change only before the store is confirmed
 * and before the widget has reported from a storefront; after that it is fixed.
 */
export async function confirmStoreStep(ctx: TenantContext, input: { slug?: string } = {}): Promise<OnboardingView> {
  const extra: Partial<typeof tenants.$inferInsert> = {};
  if (input.slug !== undefined && input.slug !== ctx.tenant.slug) {
    const problem = slugProblem(input.slug);
    if (problem) throw errors.validation({ slug: [problem] });
    const facts = await factsFor(ctx);
    if (facts.storeConfirmed || facts.widgetSeen) throw errors.validation({ slug: ['the store address is fixed once the store is confirmed'] });
    extra.slug = input.slug;
  }
  return change(ctx, (s, f) => confirmStore(s, f), extra);
}
