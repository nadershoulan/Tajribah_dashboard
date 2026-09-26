/**
 * P2.11 — trial reminders, on the worker's schedule tick.
 *
 * Three moments: three days before the trial ends, the last day, and the day it ended. Each
 * store gets each at most once: the in-app notification row is written first, in its own
 * transaction, and is the record that the reminder went out — a tick that finds it skips.
 * The email follows the commit. People who can see billing (owner, admin) get both.
 *
 * A store that chose a plan (an active or past-due subscription) gets none. A store whose
 * first tick falls inside a later window gets that one only — never a stale "3 days left".
 */
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { notifications, subscriptions, tenants } from '@/db/schema';
import { formatDate } from '@/lib/format';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import { log } from '@/server/core/observability/log';
import { withTenant } from '@/server/core/tenancy/rls';
import { notifyIn } from '@/server/modules/notifications/service';
import { billingRecipients } from './notices';

const DAY = 86_400_000;
export type TrialMilestone = 'three_days' | 'last_day' | 'ended';

/** Which reminder is due for a trial ending at `endsAt`, if any. */
export function milestoneOf(endsAt: Date, now: Date): TrialMilestone | null {
  const left = endsAt.getTime() - now.getTime();
  if (left <= 0) return left > -7 * DAY ? 'ended' : null;
  if (left <= DAY) return 'last_day';
  if (left <= 3 * DAY) return 'three_days';
  return null;
}

const COPY: Record<TrialMilestone, (date: { ar: string; en: string }) => { title: { ar: string; en: string }; body: { ar: string; en: string } }> = {
  three_days: (d) => ({
    title: { ar: 'تبقّت 3 أيام على نهاية التجربة', en: '3 days left in your free trial' },
    body: { ar: `تنتهي التجربة المجانية في ${d.ar}. اختر باقة ليستمر متجرك دون توقف.`, en: `Your free trial ends on ${d.en}. Choose a plan to keep your store going without a break.` },
  }),
  last_day: (d) => ({
    title: { ar: 'اليوم الأخير في التجربة المجانية', en: 'The last day of your free trial' },
    body: { ar: `تنتهي التجربة في ${d.ar}. بعدها يصبح متجرك للاطلاع فقط حتى تختار باقة.`, en: `Your trial ends on ${d.en}. After that your store is read-only until you choose a plan.` },
  }),
  ended: (d) => ({
    title: { ar: 'انتهت التجربة المجانية', en: 'Your free trial has ended' },
    body: { ar: `انتهت التجربة في ${d.ar}. متجرك الآن للاطلاع فقط — لا يُحذف شيء — حتى تختار باقة.`, en: `Your trial ended on ${d.en}. Your store is read-only — nothing is deleted — until you choose a plan.` },
  }),
};

export async function sendTrialReminders(now = new Date(), limit = 200): Promise<{ sent: number }> {
  const db = unsafeAdminDb(); // a platform sweep across stores: ids and dates only
  const due = await db.select({ id: tenants.id, name: tenants.name, trialEndsAt: tenants.trialEndsAt })
    .from(tenants)
    .where(and(eq(tenants.status, 'trial'), gte(tenants.trialEndsAt, new Date(now.getTime() - 7 * DAY)), lte(tenants.trialEndsAt, new Date(now.getTime() + 3 * DAY))))
    .limit(limit);
  if (!due.length) return { sent: 0 };
  const paying = new Set((await db.select({ tenantId: subscriptions.tenantId }).from(subscriptions)
    .where(and(inArray(subscriptions.tenantId, due.map((t) => t.id)), inArray(subscriptions.status, ['active', 'past_due']))))
    .map((r) => r.tenantId));

  let sent = 0;
  for (const store of due) {
    if (paying.has(store.id) || !store.trialEndsAt) continue;
    const milestone = milestoneOf(store.trialEndsAt, now);
    if (!milestone) continue;
    const type = `trial.${milestone}`;
    const copy = COPY[milestone]({ ar: formatDate(store.trialEndsAt, 'ar'), en: formatDate(store.trialEndsAt, 'en') });
    try {
      const recipients = await withTenant(store.id, async (tx) => {
        if (await tx.exists(notifications, eq(notifications.type, type))) return 0; // already reminded
        return notifyIn(tx, { type, permission: 'billing:read', title: copy.title, body: copy.body, href: '/dashboard/billing', level: milestone === 'ended' ? 'warning' : 'info' });
      });
      if (!recipients) continue;
      // After the commit: the row above is the record; an email that fails is logged, not resent.
      for (const member of await billingRecipients(store.id)) {
        await sendEmail(member.email, EMAIL.trialReminder, { title: copy.title, body: copy.body, store: store.name }, member.locale)
          .catch((error) => log.warn('trial reminder email failed', { tenantId: store.id, error: String(error) }));
      }
      sent += 1;
    } catch (error) {
      log.warn('trial reminder skipped a store', { tenantId: store.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (sent) log.info('trial reminders sent', { sent });
  return { sent };
}
