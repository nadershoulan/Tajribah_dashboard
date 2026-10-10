/**
 * T129 — plans paid by bank transfer do not renew themselves. This sweep (every minute, with the others) walks each
 * one through the end of its period:
 *
 *  1. **Reminders** before the end, on the days set on bank transfer (default 7 and 2) — the nearest one only, so a
 *     store that is already close is not sent two at once. Not while a renewal transfer is open.
 *  2. **Past due** when the period ends: the store keeps working (as for a failed card, P2.11), and is told the day
 *     it becomes read-only.
 *  3. **Expired** after the grace days: the store becomes read-only and its shop's buttons stop — never while a
 *     transfer is waiting on staff (the store paid; the wait is ours). Nothing is deleted; renewing brings it back.
 *
 * Each notice goes once (in-app keyed by its link, then email). A suspended store keeps its suspension.
 */
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { bankTransferRequests, plans, subscriptions, tenants } from '@/db/schema';
import { OPEN_STATUSES } from '@/lib/contracts/bank-transfer';
import { planByCode, type PlanCode } from '@/lib/plans';
import { loadEnv } from '@/server/core/config/env';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import { log } from '@/server/core/observability/log';
import { withTenant } from '@/server/core/tenancy/rls';
import { enqueueEdgeRefresh } from '@/server/modules/edge/publish';
import { announce } from './notices';
import { bankTransferSettings } from './payment-methods';

const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);

export type RenewalCounts = { reminded: number; pastDue: number; expired: number };

export async function sweepTransferRenewals(now = new Date(), limit = 200, appUrl: string = loadEnv().APP_URL): Promise<RenewalCounts> {
  const config = await bankTransferSettings();
  const horizon = new Date(now.getTime() + Math.max(0, ...config.reminderDays) * DAY);
  // Platform sweep across stores: ids and dates only; each change runs in its own store's transaction.
  const due = await unsafeAdminDb()
    .select({ sub: subscriptions, code: plans.code, store: tenants.name, storeStatus: tenants.status })
    .from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId)).innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .where(and(eq(subscriptions.provider, 'bank_transfer'), inArray(subscriptions.status, ['active', 'past_due']), lte(subscriptions.currentPeriodEnd, horizon)))
    .orderBy(asc(subscriptions.currentPeriodEnd)).limit(limit);
  const counts: RenewalCounts = { reminded: 0, pastDue: 0, expired: 0 };
  const link = `${appUrl}/dashboard/billing`;

  for (const { sub, code, store, storeStatus } of due) {
    try {
      const plan = planByCode(code as PlanCode).name;
      const end = sub.currentPeriodEnd;
      const graceUntil = new Date(end.getTime() + config.graceDays * DAY);
      const open = await withTenant(sub.tenantId, (db) => db.exists(bankTransferRequests, inArray(bankTransferRequests.status, [...OPEN_STATUSES])));

      if (sub.status === 'active' && end.getTime() > now.getTime()) {
        if (open) continue;
        const left = (end.getTime() - now.getTime()) / DAY;
        const days = [...config.reminderDays].sort((a, b) => a - b).find((d) => left <= d);
        if (days === undefined) continue;
        const sent = await announce(sub.tenantId, {
          type: 'subscription.renewal', href: `/dashboard/billing?renew=${day(end)}&d=${days}`, level: 'warning',
          title: { ar: `يتجدد اشتراكك قريباً`, en: 'Your plan ends soon' },
          body: { ar: `تنتهي باقة ${plan.ar} في ${day(end)}. أرسل تحويل التجديد لتستمر دون انقطاع.`, en: `${plan.en} ends on ${day(end)}. Send the renewal transfer to carry on without a break.` },
          email: (to) => sendEmail(to.email, EMAIL.renewalReminder, { store, plan, days: Math.max(1, Math.ceil(left)), endsAt: end, link }, to.locale),
        });
        if (sent) counts.reminded++;
        continue;
      }

      if (sub.status === 'active') {
        // the paid period is over: past due, still working
        const moved = await withTenant(sub.tenantId, async (db) => {
          const s = await db.lockById(subscriptions, sub.id);
          if (s.status !== 'active' || s.currentPeriodEnd.getTime() > now.getTime()) return false;
          await db.updateById(subscriptions, sub.id, { status: 'past_due' } as never);
          if (storeStatus !== 'suspended') await db.updateById(tenants, sub.tenantId, { status: 'past_due' } as never);
          return true;
        });
        if (!moved) continue;
        counts.pastDue++;
        await announce(sub.tenantId, {
          type: 'subscription.past_due', href: `/dashboard/billing?due=${day(end)}`, level: 'error',
          title: { ar: 'انتهت مدة اشتراكك', en: 'Your plan’s paid period has ended' },
          body: { ar: `يبقى متجرك يعمل حتى ${day(graceUntil)}، ثم يصبح للاطلاع فقط إلى أن تجدد.`, en: `Your store keeps working until ${day(graceUntil)}, then becomes read-only until you renew.` },
          email: (to) => sendEmail(to.email, EMAIL.subscriptionPastDue, { store, plan, graceUntil, link }, to.locale),
        });
        continue;
      }

      // past due: read-only once the grace days are over — not while a transfer waits on staff
      if (graceUntil.getTime() > now.getTime() || open) continue;
      const expired = await withTenant(sub.tenantId, async (db) => {
        const s = await db.lockById(subscriptions, sub.id);
        if (s.status !== 'past_due' || s.currentPeriodEnd.getTime() + config.graceDays * DAY > now.getTime()) return false;
        await db.updateById(subscriptions, sub.id, { status: 'expired' } as never);
        if (storeStatus !== 'suspended') await db.updateById(tenants, sub.tenantId, { status: 'cancelled' } as never);
        return true;
      });
      if (!expired) continue;
      counts.expired++;
      await enqueueEdgeRefresh(sub.tenantId); // the shop's buttons stop
      await announce(sub.tenantId, {
        type: 'subscription.expired', href: `/dashboard/billing?expired=${day(end)}`, level: 'error',
        title: { ar: 'متجرك للاطلاع فقط الآن', en: 'Your store is read-only now' },
        body: { ar: 'لم يُحذف شيء: جدّد الاشتراك ليعود كل شيء كما كان.', en: 'Nothing was deleted: renew to bring everything back as it was.' },
        email: (to) => sendEmail(to.email, EMAIL.subscriptionExpired, { store, plan, link }, to.locale),
      });
    } catch (error) {
      // one store never stops the sweep
      log.warn('transfer renewal sweep skipped one', { tenantId: sub.tenantId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (counts.reminded || counts.pastDue || counts.expired) log.info('transfer renewals', counts);
  return counts;
}
