/**
 * P4.8 — the weekly summary by email (the "scheduled report").
 *
 *  - **A member's own choice.** Nobody is sent it unasked: a member turns it on for themselves, per
 *    store, from the Analytics screen, and turns it off the same way. Staff looking at a store, an API
 *    key and background work cannot choose for anyone.
 *  - **Who may**: the same people who may export (`analytics:export`) on a plan with full analytics
 *    (T35: reports are full analytics), with a confirmed email address — a summary every week is not
 *    sent to an inbox nobody has shown to be theirs. All three are checked again each week: a member
 *    who was removed or lost the permission, a store that left the plan or went read-only, simply gets
 *    nothing (the choice stays, and works again when the reason is gone).
 *  - **Which week**: the seven whole Riyadh days from Sunday to Saturday (the Saudi week), sent from
 *    Sunday 08:00 Riyadh. A pass that runs late still sends that week. The first summary after turning
 *    it on is the next Sunday's — never an immediate one.
 *  - **Once**: a week is claimed before anything is sent (`last_sent_for`), so two passes cannot both
 *    send it; an email that fails is logged, not sent again.
 *  - **What it says**: the week's totals from the daily rollup (`daily_tenant_stats` — the same rows the
 *    screen and the CSV read), each beside the week before, and the conversion uplift only when both
 *    groups are large enough for one (`upliftOf`). No figure is estimated. T140.3 (Nader: "try-ons, shares,
 *    add-to-carts and top products, which proves the value"): also the try-on's photos and the pictures shoppers
 *    shared or saved (its own anonymous events, T140.5), and the week's most tried products with their
 *    add-to-carts. The same summary can be seen on the Analytics screen (`reportPreview`).
 */
import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { analyticsEvents, dailyProductStats, dailyTenantStats, products, reportSubscriptions, users } from '@/db/schema';
import { formatDate, formatNumber, formatPoints } from '@/lib/format';
import type { Bi, Lang } from '@/lib/lang';
import { formatMoney } from '@/lib/money';
import type { ReportSubscriptionView } from '@/lib/view-models';
import { auditedDelete, auditedInsert } from '@/server/core/audit/audit';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { loadEnv } from '@/server/core/config/env';
import { errors, isUniqueViolation } from '@/server/core/errors/problem';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import { log } from '@/server/core/observability/log';
import { buildTenantContext, type TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { conversionTotals, upliftOf } from './metrics';

const DAY = 86_400_000;
/** Riyadh is UTC+3 the year round. */
const RIYADH_OFFSET_MS = 3 * 3_600_000;
/** Summaries go out from this hour, Riyadh time, on Sunday. */
export const REPORT_HOUR = 8;

export type ReportWeek = { from: string; to: string; before: { from: string; to: string }; nextOn: string };

/**
 * The week a summary sent at `now` covers: the Sunday-to-Saturday before the latest Sunday 08:00
 * Riyadh, the week before it, and the Sunday the next summary goes out.
 */
export function reportWeek(now = new Date()): ReportWeek {
  // On a clock where Sunday 08:00 Riyadh is Sunday 00:00, the latest send day is the latest Sunday.
  const shifted = new Date(now.getTime() + RIYADH_OFFSET_MS - REPORT_HOUR * 3_600_000);
  const sendDay = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - shifted.getUTCDay() * DAY;
  const day = (offset: number) => new Date(sendDay + offset * DAY).toISOString().slice(0, 10);
  return { from: day(-7), to: day(-1), before: { from: day(-14), to: day(-8) }, nextOn: day(7) };
}

type Row = typeof reportSubscriptions.$inferSelect;

/** Only a member acts here: not staff looking at the store, not a key, not background work. */
const isMember = (ctx: TenantContext) => !ctx.actorType && !ctx.actor.isStaff;

const ownRow = (ctx: TenantContext): Promise<Row | null> => ctx.db.findOne(reportSubscriptions, eq(reportSubscriptions.userId, ctx.actor.userId));

async function emailConfirmed(userId: string): Promise<boolean> {
  // `users` is global (one person, several stores): the member's own row, by id.
  const [user] = await unsafeAdminDb().select({ at: users.emailVerifiedAt, deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId)).limit(1);
  return !!user?.at && !user.deletedAt;
}

/** Why this member cannot have the summary now, or null. */
async function blocked(ctx: TenantContext): Promise<ReportSubscriptionView['unavailable']> {
  if (!isMember(ctx) || !ctx.can('analytics:export')) return 'role';
  if (!(await entitlementsOf(ctx)).has('full_analytics')) return 'plan';
  if (!(await emailConfirmed(ctx.actor.userId))) return 'email';
  return null;
}

async function viewOf(ctx: TenantContext, row: Row | null, now: Date): Promise<ReportSubscriptionView> {
  return { weekly: !!row, email: ctx.actor.email, unavailable: await blocked(ctx), nextOn: reportWeek(now).nextOn };
}

/** API-092 — the signed-in member's own choice for this store. */
export async function reportSubscription(ctx: TenantContext, now = new Date()): Promise<ReportSubscriptionView> {
  ctx.require('analytics:read');
  return viewOf(ctx, isMember(ctx) ? await ownRow(ctx) : null, now);
}

/** API-092 — turn the member's own weekly summary on or off. Turning it off is always allowed. */
export async function setReportSubscription(ctx: TenantContext, weekly: boolean, now = new Date()): Promise<ReportSubscriptionView> {
  if (!isMember(ctx)) throw errors.forbidden('the weekly summary is a member’s own choice');
  const current = await ownRow(ctx);
  if (!weekly) {
    if (current) await auditedDelete(ctx, reportSubscriptions, current.id, { resourceType: 'report_subscription' });
    return viewOf(ctx, null, now);
  }
  ctx.require('analytics:export');
  const why = await blocked(ctx);
  if (why === 'plan') throw errors.planRequired('full_analytics');
  if (why === 'email') throw errors.forbidden('confirm your email address first — the summary is sent to it');
  if (why) throw errors.forbidden();
  if (current) return viewOf(ctx, current, now);
  try {
    // This week counts as handled: the first summary is next Sunday's, not one sent the moment it is turned on.
    const row = await auditedInsert(ctx, reportSubscriptions, { userId: ctx.actor.userId, lastSentFor: reportWeek(now).to }, { resourceType: 'report_subscription' });
    return viewOf(ctx, row as Row, now);
  } catch (error) {
    if (isUniqueViolation(error)) return viewOf(ctx, await ownRow(ctx), now); // two clicks at once: it is on
    throw error;
  }
}

export type WeekFigures = { views: number; arSessions: number; tryonSessions: number; photos: number; shares: number; addToCart: number; purchases: number; revenueMinor: number };
const NOTHING: WeekFigures = { views: 0, arSessions: 0, tryonSessions: 0, photos: 0, shares: 0, addToCart: 0, purchases: 0, revenueMinor: 0 };
/** T140.3: one of the week's most tried products. */
export type TopProduct = { name: Bi; tryons: number; addToCart: number };
export type ReportFigures = { week: WeekFigures; before: WeekFigures; upliftPct: number | null; top?: TopProduct[] };

/** A Riyadh day's start (midnight, UTC+3) as an instant, and the next day's. */
const dayStart = (day: string) => new Date(`${day}T00:00:00+03:00`);
const dayAfter = (day: string) => new Date(dayStart(day).getTime() + DAY);

/** T140.3: the try-on's own anonymous events of a kind, in these Riyadh days. */
async function tryOnEvents(ctx: TenantContext, type: 'tryon_capture' | 'tryon_share', from: string, to: string): Promise<number> {
  return Number(await ctx.db.count(analyticsEvents, and(eq(analyticsEvents.eventType, type), gte(analyticsEvents.occurredAt, dayStart(from)), lt(analyticsEvents.occurredAt, dayAfter(to)), sql`${analyticsEvents.properties}->>'surface' = 'tryon'`)));
}

/** T140.3: the week's most tried products (try-on sessions), with their add-to-carts — at most `n`, none untried. */
export async function topProducts(ctx: TenantContext, week: { from: string; to: string }, n = 3): Promise<TopProduct[]> {
  const rows = await ctx.db.find(dailyProductStats, and(gte(dailyProductStats.day, week.from), lte(dailyProductStats.day, week.to)), { limit: 10_000 });
  const by = new Map<string, { tryons: number; addToCart: number }>();
  for (const r of rows) {
    const t = by.get(r.productId) ?? { tryons: 0, addToCart: 0 };
    by.set(r.productId, { tryons: t.tryons + r.tryonSessions, addToCart: t.addToCart + r.addToCart });
  }
  const best = [...by].filter(([, v]) => v.tryons > 0).sort((a, b) => b[1].tryons - a[1].tryons || b[1].addToCart - a[1].addToCart).slice(0, n);
  if (!best.length) return [];
  const named = new Map((await ctx.db.find(products, inArray(products.id, best.map(([id]) => id)), { limit: n })).map((p) => [p.id, { ar: p.nameAr ?? p.name, en: p.name }]));
  return best.flatMap(([id, v]) => (named.has(id) ? [{ name: named.get(id)!, ...v }] : []));
}

/** The week's totals, the week before's, the week's uplift when there is one to state, and its most tried products. */
export async function weekFigures(ctx: TenantContext, week: ReportWeek): Promise<ReportFigures> {
  const rows = await ctx.db.find(dailyTenantStats, and(gte(dailyTenantStats.day, week.before.from), lte(dailyTenantStats.day, week.to)), { limit: 100 });
  const total = (from: string, to: string) => rows.filter((r) => String(r.day) >= from && String(r.day) <= to).reduce<WeekFigures>((sum, r) => ({
    views: sum.views + r.views, arSessions: sum.arSessions + r.arSessions, tryonSessions: sum.tryonSessions + r.tryonSessions,
    addToCart: sum.addToCart + r.addToCart, purchases: sum.purchases + r.purchases, revenueMinor: sum.revenueMinor + Number(r.revenueMinor ?? 0),
    photos: 0, shares: 0, // from the try-on's own events, below
  }), NOTHING);
  const withTryOn = async (from: string, to: string) => ({ ...total(from, to), photos: await tryOnEvents(ctx, 'tryon_capture', from, to), shares: await tryOnEvents(ctx, 'tryon_share', from, to) });
  return {
    week: await withTryOn(week.from, week.to),
    before: await withTryOn(week.before.from, week.before.to),
    upliftPct: upliftOf(await conversionTotals(ctx, week.from, week.to)),
    top: await topProducts(ctx, week),
  };
}

const LABELS: [keyof WeekFigures, Bi][] = [
  ['views', { ar: 'مشاهدات المنتجات', en: 'Product views' }],
  ['arSessions', { ar: 'جلسات العرض', en: 'AR sessions' }],
  ['tryonSessions', { ar: 'تجارب افتراضية', en: 'Try-on sessions' }],
  ['photos', { ar: 'صور التجربة', en: 'Try-on photos' }],
  ['shares', { ar: 'صور شاركها المتسوقون أو حفظوها', en: 'Pictures shoppers shared or saved' }],
  ['addToCart', { ar: 'إضافات إلى السلة', en: 'Added to cart' }],
  ['purchases', { ar: 'عمليات شراء', en: 'Purchases' }],
  ['revenueMinor', { ar: 'إيراد المشتريات المسجّلة', en: 'Tracked revenue' }],
];

/** The figures as the email's lines, in one language: each beside the week before. */
export function reportLines(figures: ReportFigures, lang: Lang): string {
  const show = (key: keyof WeekFigures, value: number) => (key === 'revenueMinor' ? formatMoney(value, 'SAR', lang) : formatNumber(value, lang));
  const lines = LABELS.map(([key, label]) => lang === 'ar'
    ? `${label.ar}: ${show(key, figures.week[key])} (الأسبوع الذي قبله: ${show(key, figures.before[key])})`
    : `${label.en}: ${show(key, figures.week[key])} (week before: ${show(key, figures.before[key])})`);
  if (figures.upliftPct !== null) {
    lines.push(lang === 'ar'
      ? `ارتفاع التحويل (نسبة الشراء لمن فتح العرض ناقص من لم يفتحه): ${formatPoints(figures.upliftPct, 'ar')}`
      : `Conversion uplift (purchase rate with AR minus without): ${formatPoints(figures.upliftPct, 'en')}`);
  }
  // T140.3: the week's most tried products, each with its add-to-carts
  if (figures.top?.length) {
    lines.push('', lang === 'ar' ? 'أكثر المنتجات تجربةً:' : 'Most tried on:');
    figures.top.forEach((p, i) => lines.push(lang === 'ar'
      ? `${formatNumber(i + 1, 'ar')}. ${p.name.ar} — ${formatNumber(p.tryons, 'ar')} تجربة، ${formatNumber(p.addToCart, 'ar')} إضافة إلى السلة`
      : `${i + 1}. ${p.name.en} — ${formatNumber(p.tryons, 'en')} try-ons, ${formatNumber(p.addToCart, 'en')} added to cart`));
  }
  return lines.join('\n');
}

/**
 * The weekly sweep: every choice whose week has not been handled. Cheap on every other pass of the
 * week — nothing is due once each row carries this week's last day.
 */
export async function sendWeeklyReports(now = new Date(), limit = 100): Promise<{ sent: number; skipped: number }> {
  const week = reportWeek(now);
  const unhandled = or(isNull(reportSubscriptions.lastSentFor), lt(reportSubscriptions.lastSentFor, week.to))!;
  // A platform sweep across stores: which members asked, and where to write to them.
  const due = await unsafeAdminDb().select({
    id: reportSubscriptions.id, tenantId: reportSubscriptions.tenantId, userId: reportSubscriptions.userId,
    email: users.email, locale: users.locale, confirmed: users.emailVerifiedAt, deletedAt: users.deletedAt,
  }).from(reportSubscriptions).innerJoin(users, eq(users.id, reportSubscriptions.userId)).where(unhandled).limit(limit);

  const result = { sent: 0, skipped: 0 };
  for (const sub of due) {
    try {
      // Claimed first, inside the store: whoever changes the row sends; a second pass finds nothing.
      const claimed = await withTenant(sub.tenantId, (tx) => tx.update(reportSubscriptions, and(eq(reportSubscriptions.id, sub.id), unhandled)!, { lastSentFor: week.to }));
      if (!claimed.length) continue;
      if (!sub.confirmed || sub.deletedAt) { result.skipped += 1; continue; }
      // As the member: gone from the store, or the store suspended, throws; the rest is asked of the context.
      const ctx = await buildTenantContext({ actor: { userId: sub.userId, email: sub.email, isStaff: false }, tenantId: sub.tenantId, requestId: `weekly-report-${sub.id}` });
      if (ctx.readOnly || !ctx.can('analytics:export') || !(await entitlementsOf(ctx)).has('full_analytics')) { result.skipped += 1; continue; }
      const figures = await weekFigures(ctx, week);
      await sendEmail(sub.email, EMAIL.weeklyReport, {
        store: ctx.tenant.name,
        period: { ar: `من ${formatDate(`${week.from}T12:00:00Z`, 'ar')} إلى ${formatDate(`${week.to}T12:00:00Z`, 'ar')}`, en: `${formatDate(`${week.from}T12:00:00Z`, 'en')} to ${formatDate(`${week.to}T12:00:00Z`, 'en')}` },
        lines: { ar: reportLines(figures, 'ar'), en: reportLines(figures, 'en') },
        link: `${loadEnv().APP_URL}/dashboard/analytics`,
      }, sub.locale);
      result.sent += 1;
    } catch (error) {
      result.skipped += 1;
      log.warn('weekly report not sent', { tenantId: sub.tenantId, subscription: sub.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (result.sent) log.info('weekly reports sent', result);
  return result;
}

/**
 * T140.3 — the same summary on the Analytics screen: the last whole week's lines, in both languages, for whoever may
 * receive it by email (the same three checks) — so a merchant sees what the email says without waiting for Sunday.
 */
export async function reportPreview(ctx: TenantContext, now = new Date()): Promise<{ period: Bi; lines: Bi }> {
  const why = await blocked(ctx);
  if (why === 'role') throw errors.forbidden('the weekly summary is for those who may export analytics');
  if (why === 'plan') throw errors.forbidden('the weekly summary is part of full analytics');
  const week = reportWeek(now);
  const figures = await weekFigures(ctx, week);
  return {
    period: { ar: `من ${formatDate(`${week.from}T12:00:00Z`, 'ar')} إلى ${formatDate(`${week.to}T12:00:00Z`, 'ar')}`, en: `${formatDate(`${week.from}T12:00:00Z`, 'en')} to ${formatDate(`${week.to}T12:00:00Z`, 'en')}` },
    lines: { ar: reportLines(figures, 'ar'), en: reportLines(figures, 'en') },
  };
}

