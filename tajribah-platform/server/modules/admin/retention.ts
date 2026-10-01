/**
 * A14 — retention (docs/DECISIONS.md T22): how long each kind of data is kept, and the sweep
 * that removes what has passed its time. The periods live here, in one table; the console shows
 * the same table and what the next sweep would remove.
 *
 * Runs as the admin role — the role that keeps DML on append-only tables for exactly this.
 * Invoices, the AI credit ledger and coupon uses are never swept. Deleted stores are listed for
 * a person to review, never purged automatically (purging a store would delete its invoices).
 */
import { and, count, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { unsafeAdminDb, type Db } from '@/db/client';
import { analyticsEvents, auditLogs, jobs, notifications, sessions, staffAudit, tenants, verificationTokens, webhookEvents } from '@/db/schema';
import { log } from '@/server/core/observability/log';

const DAY = 86_400_000;
const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

export type RetentionRule = { key: string; what: { ar: string; en: string }; keep: { ar: string; en: string }; table: PgTable; where: (now: Date) => SQL };

export const RETENTION: RetentionRule[] = [
  { key: 'analytics_events', what: { ar: 'أحداث التحليلات الخام', en: 'Raw analytics events' }, keep: { ar: '90 يومًا (تبقى الملخصات اليومية)', en: '90 days (daily rollups stay)' },
    table: analyticsEvents, where: (now) => lt(analyticsEvents.occurredAt, ago(now, 90)) },
  { key: 'sessions', what: { ar: 'الجلسات المنتهية', en: 'Ended sessions' }, keep: { ar: '90 يومًا بعد انتهائها', en: '90 days after they end' },
    table: sessions, where: (now) => or(lt(sessions.revokedAt, ago(now, 90)), and(isNull(sessions.revokedAt), lt(sessions.expiresAt, ago(now, 90))))! },
  { key: 'verification_tokens', what: { ar: 'رموز الاستخدام الواحد', en: 'One-time tokens' }, keep: { ar: '7 أيام بعد الاستخدام أو الانتهاء', en: '7 days after use or expiry' },
    table: verificationTokens, where: (now) => or(lt(verificationTokens.consumedAt, ago(now, 7)), lt(verificationTokens.expiresAt, ago(now, 7)))! },
  { key: 'notifications', what: { ar: 'الإشعارات', en: 'Notifications' }, keep: { ar: 'المقروءة 180 يومًا، غير المقروءة سنة', en: 'read 180 days, unread 1 year' },
    table: notifications, where: (now) => or(lt(notifications.readAt, ago(now, 180)), and(isNull(notifications.readAt), lt(notifications.createdAt, ago(now, 365))))! },
  { key: 'webhook_events', what: { ar: 'إشعارات المتاجر الواردة', en: 'Webhook deliveries' }, keep: { ar: 'المعالجة 30 يومًا، الفاشلة 90', en: 'processed 30 days, failed 90' },
    table: webhookEvents, where: (now) => or(
      and(inArray(webhookEvents.status, ['processed', 'ignored']), lt(webhookEvents.createdAt, ago(now, 30))),
      and(eq(webhookEvents.status, 'failed'), lt(webhookEvents.createdAt, ago(now, 90))))! },
  { key: 'jobs', what: { ar: 'المهام المنتهية', en: 'Finished jobs' }, keep: { ar: 'المنجزة 30 يومًا، الميتة 90', en: 'done 30 days, dead 90' },
    table: jobs, where: (now) => or(
      and(inArray(jobs.state, ['done', 'cancelled']), lt(jobs.finishedAt, ago(now, 30))),
      and(eq(jobs.state, 'dead'), lt(jobs.finishedAt, ago(now, 90))))! },
  { key: 'audit_logs', what: { ar: 'سجل نشاط المتاجر', en: 'Store activity trail' }, keep: { ar: '3 سنوات', en: '3 years' },
    table: auditLogs, where: (now) => lt(auditLogs.createdAt, ago(now, 3 * 365)) },
  { key: 'staff_audit', what: { ar: 'سجل الموظفين', en: 'Staff trail' }, keep: { ar: '5 سنوات', en: '5 years' },
    table: staffAudit, where: (now) => lt(staffAudit.createdAt, ago(now, 5 * 365)) },
];

/** Kept and never swept — shown alongside, so nobody wonders. */
export const NEVER_SWEPT = [
  { what: { ar: 'الفواتير وبنودها', en: 'Invoices and their lines' }, why: { ar: 'سجلات ضريبة القيمة المضافة تُحفظ 6 سنوات على الأقل', en: 'VAT records are kept at least 6 years' } },
  { what: { ar: 'سجل أرصدة الذكاء الاصطناعي', en: 'AI credit ledger' }, why: { ar: 'الرصيد هو مجموع السجل', en: 'The balance is the sum of the ledger' } },
  { what: { ar: 'استخدامات الكوبونات', en: 'Coupon uses' }, why: { ar: 'تحدد من استخدم أي كوبون', en: 'They decide who has used which coupon' } },
];

export type RetentionState = {
  rules: { key: string; what: { ar: string; en: string }; keep: { ar: string; en: string }; due: number }[];
  never: typeof NEVER_SWEPT;
  /** Stores deleted more than 90 days ago: for a person to review, never purged automatically. */
  deletedStoresForReview: number;
  asOf: string;
};

export async function retentionState(now = new Date(), db: Db = unsafeAdminDb()): Promise<RetentionState> {
  const rules = [];
  for (const rule of RETENTION) {
    const [row] = await db.select({ n: count() }).from(rule.table).where(rule.where(now));
    rules.push({ key: rule.key, what: rule.what, keep: rule.keep, due: Number(row?.n ?? 0) });
  }
  const [stores] = await db.select({ n: count() }).from(tenants).where(and(isNotNull(tenants.deletedAt), lt(tenants.deletedAt, ago(now, 90))));
  return { rules, never: NEVER_SWEPT, deletedStoresForReview: Number(stores?.n ?? 0), asOf: now.toISOString() };
}

/** Remove everything past its time. Idempotent; returns what each rule removed. */
export async function sweepRetention(now = new Date(), db: Db = unsafeAdminDb()): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};
  for (const rule of RETENTION) {
    // One constant per removed row, not the row: an hour of shop events is ~100k rows (P4.2 live).
    const rows = await db.delete(rule.table).where(rule.where(now)).returning({ gone: sql<number>`1` });
    removed[rule.key] = rows.length;
  }
  const total = Object.values(removed).reduce((a, b) => a + b, 0);
  if (total) log.info('retention sweep', removed);
  return removed;
}

let lastSweep = 0;
/** For the worker's minute tick: at most once an hour. */
export async function sweepRetentionHourly(now = new Date()): Promise<void> {
  if (now.getTime() - lastSweep < 3_600_000) return;
  lastSweep = now.getTime();
  await sweepRetention(now);
}
