/**
 * P1.1 — onboarding: gather the facts, evaluate the checklist, record skips.
 *
 * Every read goes through `ctx.db` (tenant-scoped); every change goes through
 * `auditedUpdate`, so "who skipped connecting Salla, and when" is in the store's trail.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  analyticsEvents, models3d, products, storeConnections, subscriptions, tenants,
  type OnboardingState,
} from '@/db/schema';
import { auditedUpdate } from '@/server/core/audit/audit';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import {
  OnboardingError, confirmStore, evaluate, skip, unskip,
  type Facts, type OnboardingView, type StepKey,
} from './machine';

/** One indexed existence check per fact — cheap enough to run on every dashboard load. */
export async function factsFor(ctx: TenantContext): Promise<Facts> {
  const tenant = await ctx.db.requireById(tenants, ctx.tenantId);
  const [hasPlan, hasActiveConnection, hasSizedProduct, hasReadyModel, widgetSeen] = await Promise.all([
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
    // The widget reports a product view from the live storefront: the install worked.
    ctx.db.exists(analyticsEvents, eq(analyticsEvents.eventType, 'product_view')),
  ]);
  return {
    storeConfirmed: tenant.onboardingState?.completedSteps?.includes('store') ?? false,
    hasPlan, hasActiveConnection, hasSizedProduct, hasReadyModel, widgetSeen,
  };
}

export async function onboardingOf(ctx: TenantContext): Promise<OnboardingView> {
  const tenant = await ctx.db.requireById(tenants, ctx.tenantId);
  return evaluate(await factsFor(ctx), tenant.onboardingState);
}

type Change = (state: OnboardingState | null | undefined, facts: Facts) => OnboardingState;

async function change(ctx: TenantContext, apply: Change): Promise<OnboardingView> {
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
  await auditedUpdate(ctx, tenants, ctx.tenantId, { onboardingState: next }, { resourceType: 'onboarding' });
  return evaluate(facts, next);
}

export const skipStep = (ctx: TenantContext, step: StepKey) => change(ctx, (s, f) => skip(s, step, f));
export const unskipStep = (ctx: TenantContext, step: StepKey) => change(ctx, (s, f) => unskip(s, step, f));
export const confirmStoreStep = (ctx: TenantContext) => change(ctx, (s, f) => confirmStore(s, f));
