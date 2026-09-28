/**
 * P1.22 — the home screen's numbers, from the database.
 *
 * Nothing here is estimated: the 30-day figures and the daily series come from
 * `daily_tenant_stats` (filled by the analytics rollup, P4 — until it runs they are honestly
 * zero), counts from the catalogue, usage against the plan, onboarding from the facts the
 * checklist is built on (P1.1), activity from the audit trail. Conversion uplift and the
 * returns delta stay null until P4 has enough data to mean anything.
 */
import { and, desc, eq, gte, isNull, ne } from 'drizzle-orm';
import { auditLogs, dailyTenantStats, models3d, products, tenantMemberships } from '@/db/schema';
import { riyadhDay } from '@/lib/format';
import { STEP_COPY } from '@/lib/onboarding-steps';
import type { ActivityItem, DashboardSummary, MetricPoint } from '@/lib/view-models';
import { currentUsage, entitlementsOf } from '@/server/core/billing/entitlements';
import type { TenantContext } from '@/server/core/tenancy/context';
import { listConnections } from '@/server/modules/connections/service';
import { onboardingOf } from '@/server/modules/onboarding/service';
import { conversionTotals, upliftOf } from '@/server/modules/analytics/metrics';

const DAY = 86_400_000;

export async function dashboardSummary(ctx: TenantContext, now = new Date()): Promise<DashboardSummary> {
  ctx.require('products:read');
  const entitlements = await entitlementsOf(ctx);
  const live = and(isNull(products.deletedAt), ne(products.status, 'archived'));
  const [productCount, arEnabled, models, modelsReady, teamMembers, onboarding, connections] = await Promise.all([
    ctx.db.count(products, live),
    ctx.db.count(products, and(live, eq(products.arEnabled, true))),
    ctx.db.count(models3d),
    ctx.db.count(models3d, eq(models3d.status, 'ready')),
    ctx.db.count(tenantMemberships, eq(tenantMemberships.status, 'active')),
    onboardingOf(ctx),
    ctx.can('connections:read') ? listConnections(ctx) : Promise.resolve([]),
  ]);

  // 30 Riyadh days, today included; days without a rollup row are zero, not missing.
  const days = Array.from({ length: 30 }, (_, i) => riyadhDay(now.getTime() - (29 - i) * DAY));
  const rows = await ctx.db.find(dailyTenantStats, gte(dailyTenantStats.day, days[0]), { limit: 40 });
  const byDay = new Map(rows.map((r) => [String(r.day), r]));
  const series: MetricPoint[] = days.map((day) => {
    const r = byDay.get(day);
    return { day, views: r?.views ?? 0, arSessions: r?.arSessions ?? 0, tryonSessions: r?.tryonSessions ?? 0, purchases: r?.purchases ?? 0 };
  });
  const sum = (key: 'views' | 'arSessions' | 'tryonSessions' | 'addToCart' | 'purchases' | 'revenueMinor') =>
    days.reduce((total, day) => total + Number(byDay.get(day)?.[key] ?? 0), 0);

  // P2.2: the quota's own figures. The home screen used to count live products only (the quota
  // counts archived ones too) and summed AR sessions from a 30-day window, which missed the 1st
  // of a 31-day month on the 31st.
  const [productsUsed, arThisPeriod, aiCreditsUsed, storageUsed] = await Promise.all([
    currentUsage(ctx, 'products', now), currentUsage(ctx, 'ar_sessions', now),
    currentUsage(ctx, 'ai_credits', now), currentUsage(ctx, 'storage_gb', now),
  ]);

  const steps = STEP_COPY.map((copy) => {
    const step = onboarding.steps.find((s) => s.key === copy.key);
    return { ...copy, done: step?.done ?? false, skipped: step?.skipped ?? false };
  });
  const connection = connections.find((c) => c.status === 'active') ?? connections[0] ?? null;

  return {
    tenant: {
      id: ctx.tenant.id, name: ctx.tenant.name, slug: ctx.tenant.slug, plan: entitlements.plan.code,
      status: ctx.tenant.status as DashboardSummary['tenant']['status'], trialEndsAt: ctx.tenant.trialEndsAt?.toISOString() ?? null,
      logoUrl: ctx.tenant.logoUrl, role: ctx.role === 'system' ? 'viewer' : ctx.role, readOnly: ctx.readOnly,
    },
    onboarding: { complete: onboarding.complete, steps },
    counts: { products: productCount, arEnabled, models, modelsReady, teamMembers },
    usage: {
      products: { used: productsUsed, limit: entitlements.limit('products') },
      arSessions: { used: arThisPeriod, limit: entitlements.limit('ar_sessions') },
      aiCredits: { used: aiCreditsUsed, limit: entitlements.limit('ai_credits') },
      storage: { used: Math.round(storageUsed * 100) / 100, limit: entitlements.limit('storage_gb') },
    },
    last30: {
      views: sum('views'), arSessions: sum('arSessions'), tryonSessions: sum('tryonSessions'),
      addToCart: sum('addToCart'), purchases: sum('purchases'), revenueMinor: sum('revenueMinor'),
      // P4.4's rule, shared: null unless both groups reach 100 sessions. Returns wait on P4.7.
      upliftPct: entitlements.has('full_analytics') ? upliftOf(await conversionTotals(ctx, days[0]!, days[days.length - 1]!)) : null, // T35: full analytics
      returnDeltaPct: null,
    },
    series,
    connection,
    activity: await activityOf(ctx),
  };
}

/** The audit trail, turned into the few lines a merchant wants on the home screen. */
async function activityOf(ctx: TenantContext): Promise<ActivityItem[]> {
  const rows = await ctx.db.find(auditLogs, undefined, { limit: 60, orderBy: desc(auditLogs.createdAt) });
  const items: ActivityItem[] = [];
  for (const row of rows) {
    const item = describe(row);
    if (item) items.push({ ...item, id: row.id, at: row.createdAt.toISOString() });
    if (items.length === 8) break;
  }
  return items;
}

type Row = typeof auditLogs.$inferSelect;
function describe(row: Row): Omit<ActivityItem, 'id' | 'at'> | null {
  const after = (row.changes?.after ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => Number(v ?? 0);
  if (row.resourceType === 'store_connection' && row.action === 'sync') {
    if (after.status === 'done') {
      return { kind: 'sync', level: n(after.failed) > 0 ? 'warning' : 'success',
        title: { ar: 'انتهت مزامنة المتجر', en: 'Store sync finished' },
        detail: { ar: `جديد ${n(after.created)} · محدَّث ${n(after.updated)} · لم يُستورد ${n(after.failed)}`, en: `${n(after.created)} new · ${n(after.updated)} updated · ${n(after.failed)} not imported` } };
    }
    if (after.status === 'failed') {
      return { kind: 'sync', level: 'error', title: { ar: 'فشلت مزامنة المتجر', en: 'Store sync failed' },
        detail: after.error ? { ar: String(after.error), en: String(after.error) } : null };
    }
    return null;
  }
  if (row.resourceType === 'store_connection' && row.action === 'connect') {
    return { kind: 'sync', level: 'success', title: { ar: 'رُبط المتجر', en: 'Store connected' }, detail: null };
  }
  if (row.resourceType === 'store_connection' && (row.action === 'disconnect' || (row.action === 'update' && after.status === 'revoked'))) {
    return { kind: 'sync', level: 'warning', title: { ar: 'فُصل المتجر', en: 'Store disconnected' }, detail: null };
  }
  if (row.resourceType === 'model' && row.action === 'publish') {
    return { kind: 'publish', level: 'success', title: { ar: `نُشر الإصدار ${n(after.version)} من نموذج`, en: `Model version ${n(after.version)} published` }, detail: null };
  }
  if (row.resourceType === 'model_version' && row.action === 'update' && (after.status === 'ready' || after.status === 'failed')) {
    return after.status === 'ready'
      ? { kind: 'model', level: 'success', title: { ar: 'نموذج جاهز للنشر', en: 'A model is ready to publish' },
          detail: after.optimizedBytes ? { ar: after.withinTarget ? 'ضمن هدف 2 ميجابايت' : 'أكبر من 2 ميجابايت', en: after.withinTarget ? 'Within the 2 MB target' : 'Over the 2 MB target' } : null }
      : { kind: 'model', level: 'error', title: { ar: 'رُفض ملف نموذج', en: 'A model file was refused' },
          detail: after.error ? { ar: String(after.error), en: String(after.error) } : null };
  }
  if (row.resourceType === 'invitation' && row.action === 'invite') {
    return { kind: 'team', level: 'info', title: { ar: `دعوة إلى ${String(after.email ?? '')}`, en: `Invitation sent to ${String(after.email ?? '')}` }, detail: null };
  }
  if (row.resourceType === 'team_member' && row.action === 'create') {
    return { kind: 'team', level: 'success', title: { ar: `انضم ${String(after.email ?? '')} إلى الفريق`, en: `${String(after.email ?? '')} joined the team` }, detail: null };
  }
  return null;
}
