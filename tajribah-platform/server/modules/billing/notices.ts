/**
 * P2.13 — billing notices: an invoice issued, a payment that failed (trial reminders: trial.ts).
 *
 * Each one goes to the people who handle billing (owner, admin): in-app, then by email in
 * their own language. **Once each**: the in-app row is written first in its own transaction and
 * names what it is about (`href`); a second call for the same invoice or payment finds it and
 * sends nothing. The email follows the commit; one that fails is logged, not retried.
 */
import { and, eq } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { notifications, tenantMemberships, users } from '@/db/schema';
import type { Bi, Lang } from '@/lib/lang';
import { formatMoney } from '@/lib/money';
import { permissionsFor } from '@/lib/permissions';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import { log } from '@/server/core/observability/log';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { notifyIn } from '@/server/modules/notifications/service';

/** Owners and admins of a store, with their address and language — who billing mail goes to. */
export async function billingRecipients(tenantId: string): Promise<{ email: string; locale: Lang }[]> {
  // A cross-table read of the store's members and their accounts (users are global).
  const members = await unsafeAdminDb().select({ role: tenantMemberships.role, email: users.email, locale: users.locale })
    .from(tenantMemberships).innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, 'active')));
  return members.filter((m) => permissionsFor(m.role).has('billing:read')).map((m) => ({ email: m.email, locale: m.locale }));
}

/** In-app once (keyed by type + href), then email. Returns false when it had already gone out. */
async function announce(tenantId: string, input: {
  type: string; href: string; title: Bi; body: Bi; level: 'info' | 'warning' | 'error';
  email: (to: { email: string; locale: Lang }) => Promise<void>;
}): Promise<boolean> {
  const recipients = await withTenant(tenantId, async (db) => {
    if (await db.exists(notifications, and(eq(notifications.type, input.type), eq(notifications.href, input.href)))) return 0;
    return notifyIn(db, { type: input.type, permission: 'billing:read', title: input.title, body: input.body, href: input.href, level: input.level });
  });
  if (!recipients) return false;
  for (const to of await billingRecipients(tenantId)) {
    await input.email(to).catch((error) => log.warn('billing email failed', { tenantId, type: input.type, error: String(error) }));
  }
  return true;
}

/** An invoice was issued (called by issueInvoice after its commit). */
export async function announceInvoice(ctx: TenantContext, invoice: { id: string; number: string; totalMinor: number; currency: string }, appUrl: string): Promise<boolean> {
  const total = { ar: formatMoney(invoice.totalMinor, invoice.currency, 'ar'), en: formatMoney(invoice.totalMinor, invoice.currency, 'en') };
  const href = `/dashboard/billing/invoices/${invoice.id}`;
  return announce(ctx.tenantId, {
    type: 'invoice.issued', href, level: 'info',
    title: { ar: `فاتورة جديدة ${invoice.number}`, en: `New invoice ${invoice.number}` },
    body: { ar: `بمبلغ ${total.ar} شامل الضريبة.`, en: `For ${total.en} including VAT.` },
    email: (to) => sendEmail(to.email, EMAIL.invoiceIssued, { number: invoice.number, total: total[to.locale], link: `${appUrl}${href}`, store: ctx.tenant.name }, to.locale),
  });
}

/** A payment failed (called by dunning, P2.8): once per failed payment. */
export async function announcePaymentFailed(ctx: TenantContext, payment: { id: string; amountMinor: number; currency: string; retryAt: Date | null }, appUrl: string): Promise<boolean> {
  const amount = { ar: formatMoney(payment.amountMinor, payment.currency, 'ar'), en: formatMoney(payment.amountMinor, payment.currency, 'en') };
  const href = `/dashboard/billing?payment=${payment.id}`;
  return announce(ctx.tenantId, {
    type: 'payment.failed', href, level: 'error',
    title: { ar: 'تعذّر تحصيل الدفعة', en: 'A payment did not go through' },
    body: { ar: `لم نتمكن من تحصيل ${amount.ar}. حدّث طريقة الدفع حتى لا يتوقف متجرك.`, en: `We could not collect ${amount.en}. Update your payment method so your store keeps running.` },
    email: (to) => sendEmail(to.email, EMAIL.paymentFailed, { amount: amount[to.locale], link: `${appUrl}/dashboard/billing`, store: ctx.tenant.name, retryAt: payment.retryAt }, to.locale),
  });
}
