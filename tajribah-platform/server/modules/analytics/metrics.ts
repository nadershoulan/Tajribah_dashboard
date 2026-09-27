/**
 * P4.4 — the dashboard's analytics read path (read side of P4; the write side — collector,
 * rollups — belongs to P4.2/P4.3). Reads **only the rollup tables** (`daily_tenant_stats`,
 * `daily_product_stats`, `conversion_daily`, `device_breakdown_daily`), never raw events: D5's
 * rule that analytics never touches the transactional read path, and the contract agreed with the
 * rollup writer is those four tables exactly as they are.
 *
 * Every figure is over whole Riyadh days, today included; a day with no rollup row is zero, not
 * missing. Reads go through the store's own scope (`ctx.db`), so a store only ever sees its rows.
 *
 * Uplift (`upliftOf`) is the one place the rule lives — the home screen and this screen share it:
 * conversion with AR/try-on minus conversion without, as a fraction (0.031 = 3.1 percentage points,
 * the unit the screens multiply by 100), and **null unless both groups have at least `MIN_SESSIONS`
 * sessions**. A small sample does not get a number.
 */
import { and, gte, inArray, lte } from 'drizzle-orm';
import { conversionDaily, dailyProductStats, dailyTenantStats, deviceBreakdownDaily, products } from '@/db/schema';
import { riyadhDay } from '@/lib/format';
import type { AnalyticsView, MetricPoint } from '@/lib/view-models';
import type { TenantContext } from '@/server/core/tenancy/context';

const DAY = 86_400_000;
export type Range = '7d' | '30d' | '90d';
export const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };
/** Below this many sessions on either side, the difference is noise and is not shown. */
export const MIN_SESSIONS = 100;

/** The Riyadh days of a range, oldest first, ending today. */
export function daysOf(range: Range, now = new Date()): string[] {
  const n = RANGE_DAYS[range];
  return Array.from({ length: n }, (_, i) => riyadhDay(now.getTime() - (n - 1 - i) * DAY));
}

type ConversionTotals = { sessionsWithAr: number; purchasesWithAr: number; sessionsWithoutAr: number; purchasesWithoutAr: number };

/** Conversion with minus without, as a fraction to a tenth of a point; null on a small sample. */
export function upliftOf(t: ConversionTotals): number | null {
  if (t.sessionsWithAr < MIN_SESSIONS || t.sessionsWithoutAr < MIN_SESSIONS) return null;
  const withAr = t.purchasesWithAr / t.sessionsWithAr;
  const without = t.purchasesWithoutAr / t.sessionsWithoutAr;
  return Math.round((withAr - without) * 1000) / 1000;
}

const addConversion = (a: ConversionTotals, r: ConversionTotals): ConversionTotals => ({
  sessionsWithAr: a.sessionsWithAr + r.sessionsWithAr, purchasesWithAr: a.purchasesWithAr + r.purchasesWithAr,
  sessionsWithoutAr: a.sessionsWithoutAr + r.sessionsWithoutAr, purchasesWithoutAr: a.purchasesWithoutAr + r.purchasesWithoutAr,
});
const ZERO: ConversionTotals = { sessionsWithAr: 0, purchasesWithAr: 0, sessionsWithoutAr: 0, purchasesWithoutAr: 0 };

/** The store's conversion totals over some days — for the home screen's uplift too. */
export async function conversionTotals(ctx: TenantContext, from: string, to: string): Promise<ConversionTotals> {
  const rows = await ctx.db.find(conversionDaily, and(gte(conversionDaily.day, from), lte(conversionDaily.day, to)), { limit: 100_000 });
  return rows.reduce(addConversion, ZERO);
}

export async function analyticsView(ctx: TenantContext, range: Range, now = new Date()): Promise<AnalyticsView> {
  ctx.require('analytics:read');
  const days = daysOf(range, now);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const [tenantRows, productRows, conversionRows, deviceRows] = await Promise.all([
    ctx.db.find(dailyTenantStats, and(gte(dailyTenantStats.day, from), lte(dailyTenantStats.day, to)), { limit: 200 }),
    ctx.db.find(dailyProductStats, and(gte(dailyProductStats.day, from), lte(dailyProductStats.day, to)), { limit: 100_000 }),
    ctx.db.find(conversionDaily, and(gte(conversionDaily.day, from), lte(conversionDaily.day, to)), { limit: 100_000 }),
    ctx.db.find(deviceBreakdownDaily, and(gte(deviceBreakdownDaily.day, from), lte(deviceBreakdownDaily.day, to)), { limit: 1000 }),
  ]);

  const byDay = new Map(tenantRows.map((r) => [String(r.day), r]));
  const series: MetricPoint[] = days.map((day) => {
    const r = byDay.get(day);
    return { day, views: r?.views ?? 0, arSessions: r?.arSessions ?? 0, tryonSessions: r?.tryonSessions ?? 0, purchases: r?.purchases ?? 0 };
  });
  const sum = (key: 'views' | 'arSessions' | 'tryonSessions' | 'addToCart' | 'purchases' | 'revenueMinor') =>
    tenantRows.reduce((total, r) => total + Number(r[key] ?? 0), 0);
  const conversion = conversionRows.reduce(addConversion, ZERO);

  // Devices: the three the screen shows; `unknown` stays out rather than being guessed into one.
  const devices = (['mobile', 'tablet', 'desktop'] as const).map((device) => {
    const rows = deviceRows.filter((r) => r.deviceType === device);
    return { device, sessions: rows.reduce((s, r) => s + r.sessions, 0), arSupported: rows.reduce((s, r) => s + r.arSupported, 0) };
  });

  // Top products by views, with each product's own uplift under the same rule.
  const perProduct = new Map<string, { views: number; arSessions: number; purchases: number; conversion: ConversionTotals }>();
  for (const r of productRows) {
    const p = perProduct.get(r.productId) ?? { views: 0, arSessions: 0, purchases: 0, conversion: ZERO };
    perProduct.set(r.productId, { ...p, views: p.views + r.views, arSessions: p.arSessions + r.arSessions, purchases: p.purchases + r.purchases });
  }
  for (const r of conversionRows) {
    const p = perProduct.get(r.productId) ?? { views: 0, arSessions: 0, purchases: 0, conversion: ZERO };
    perProduct.set(r.productId, { ...p, conversion: addConversion(p.conversion, r) });
  }
  const top = [...perProduct.entries()].sort((a, b) => b[1].views - a[1].views || a[0].localeCompare(b[0])).slice(0, 10);
  const names = top.length
    ? new Map((await ctx.db.find(products, inArray(products.id, top.map(([id]) => id)), { limit: 10 })).map((p) => [p.id, p.name]))
    : new Map<string, string>();

  const totals = {
    views: sum('views'), arSessions: sum('arSessions'), tryonSessions: sum('tryonSessions'),
    addToCart: sum('addToCart'), purchases: sum('purchases'), revenueMinor: sum('revenueMinor'),
    upliftPct: upliftOf(conversion),
    // Return rates need returns from the store platform (P4.7, blocked on order sync): not a guess.
    returnDeltaPct: null,
  };

  return {
    range,
    totals,
    series,
    byDevice: devices,
    topProducts: top.map(([productId, p]) => ({
      productId, name: names.get(productId) ?? '—', views: p.views, arSessions: p.arSessions, purchases: p.purchases, upliftPct: upliftOf(p.conversion),
    })),
    funnel: [
      { step: { ar: 'مشاهدة المنتج', en: 'Product view' }, value: totals.views },
      { step: { ar: 'فتح العرض', en: 'AR opened' }, value: totals.arSessions },
      { step: { ar: 'تجربة افتراضية', en: 'Try-on started' }, value: totals.tryonSessions },
      { step: { ar: 'أضيف للسلة', en: 'Added to cart' }, value: totals.addToCart },
      { step: { ar: 'شراء', en: 'Purchase' }, value: totals.purchases },
    ],
  };
}

/**
 * P4.8 — the range as a CSV, one row per Riyadh day (empty days included, as zero), from the
 * same rollup the screen reads. Money in riyals with two decimals. `analytics:export` only —
 * viewers can read the screen but not take the data away.
 */
export async function analyticsCsv(ctx: TenantContext, range: Range, now = new Date()): Promise<string> {
  ctx.require('analytics:export');
  const days = daysOf(range, now);
  const rows = await ctx.db.find(dailyTenantStats, and(gte(dailyTenantStats.day, days[0]!), lte(dailyTenantStats.day, days[days.length - 1]!)), { limit: 200 });
  const byDay = new Map(rows.map((r) => [String(r.day), r]));
  const lines = ['day,views,ar_sessions,tryon_sessions,add_to_cart,purchases,revenue_sar'];
  for (const day of days) {
    const r = byDay.get(day);
    lines.push([day, r?.views ?? 0, r?.arSessions ?? 0, r?.tryonSessions ?? 0, r?.addToCart ?? 0, r?.purchases ?? 0, (Number(r?.revenueMinor ?? 0) / 100).toFixed(2)].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
