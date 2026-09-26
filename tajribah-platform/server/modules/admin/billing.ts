/**
 * A7 — subscriptions and invoices across every store, for staff (ADM-17…19). Reads only:
 * refunds and payment actions wait on the payment provider (A8, Moyasar).
 *
 * The invoice itself is opened through the store's own `invoiceOf`, in the read-only inspection
 * context (A3) — staff see exactly the document the merchant sees, never a second rendering.
 */
import { and, count, desc, eq, gte, ilike, inArray, isNull, lt, sum, type SQL } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { INVOICE_STATUS, SUBSCRIPTION_STATUS, invoices, plans, subscriptions, tenants } from '@/db/schema';
import type { InvoiceDocument } from '@/lib/contracts/invoices';
import type { PlanCode } from '@/lib/plans';
import { errors } from '@/server/core/errors/problem';
import { invoiceOf } from '@/server/modules/billing/invoices';
import type { StaffContext } from './access';
import { inspectionContext } from './stores';

type Status = (typeof SUBSCRIPTION_STATUS)[number];
type InvoiceStatus = (typeof INVOICE_STATUS)[number];
type StoreRef = { id: string; name: string; nameAr: string | null; slug: string };

export type SubscriptionRow = {
  id: string; store: StoreRef; plan: PlanCode; status: Status; cycle: 'monthly' | 'annual';
  /** The plan's list price for this cycle — what it costs today (T19), not a record of a charge. */
  listPriceMinor: number | null; currency: string;
  currentPeriodEnd: string; cancelAtPeriodEnd: boolean; provider: string; createdAt: string;
};

/** ADM-17 — subscriptions, newest first, by status / plan / cycle, with a count per status. */
export async function listSubscriptions(input: { status?: Status; plan?: PlanCode; cycle?: 'monthly' | 'annual'; before?: string; limit?: number } = {}): Promise<{ subscriptions: SubscriptionRow[]; next: string | null; byStatus: Partial<Record<Status, number>> }> {
  const db = unsafeAdminDb(); // staff read across every store (A1)
  const limit = Math.min(input.limit ?? 50, 100);
  const scope: (SQL | undefined)[] = [
    isNull(tenants.deletedAt),
    input.plan ? eq(plans.code, input.plan) : undefined,
    input.cycle ? eq(subscriptions.billingCycle, input.cycle) : undefined,
  ];
  const rows = await db.select({ sub: subscriptions, tenant: tenants, plan: plans }).from(subscriptions)
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId)).innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(...scope, input.status ? eq(subscriptions.status, input.status) : undefined, input.before ? lt(subscriptions.id, input.before) : undefined))
    .orderBy(desc(subscriptions.id)).limit(limit + 1);
  // The counts follow the plan and cycle filters, not the status one — they are the status tabs.
  const counts = await db.select({ status: subscriptions.status, n: count() }).from(subscriptions)
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId)).innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(and(...scope)).groupBy(subscriptions.status);
  const page = rows.slice(0, limit);
  return {
    subscriptions: page.map(({ sub, tenant, plan }) => ({
      id: sub.id, store: storeRef(tenant), plan: plan.code, status: sub.status, cycle: sub.billingCycle,
      listPriceMinor: sub.billingCycle === 'annual' ? plan.priceAnnualMinor : plan.priceMonthlyMinor, currency: plan.currency,
      currentPeriodEnd: sub.currentPeriodEnd.toISOString(), cancelAtPeriodEnd: sub.cancelAtPeriodEnd, provider: sub.provider,
      createdAt: sub.createdAt.toISOString(),
    })),
    next: rows.length > limit ? page.at(-1)!.sub.id : null,
    byStatus: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
  };
}

export type InvoiceListRow = {
  id: string; number: string; store: StoreRef; status: InvoiceStatus;
  subtotalMinor: number; vatMinor: number; totalMinor: number; currency: string;
  issuedAt: string | null; paidAt: string | null; zatcaStatus: string | null;
};

/** `YYYY-MM` → that calendar month in Asia/Riyadh (UTC+3, no DST), as [start, end). */
export function riyadhMonth(month: string): [Date, Date] | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]) - 1;
  const shift = 3 * 60 * 60 * 1000;
  return [new Date(Date.UTC(y, mo, 1) - shift), new Date(Date.UTC(y, mo + 1, 1) - shift)];
}

/**
 * ADM-18 — invoices, newest first, by status, Riyadh month of issue, or number. The totals are
 * over the whole filter, not the page — and only invoices that count (issued or paid).
 */
export async function listInvoices(input: { status?: InvoiceStatus; month?: string; q?: string; before?: string; limit?: number } = {}): Promise<{ invoices: InvoiceListRow[]; next: string | null; totals: { count: number; totalMinor: number; vatMinor: number } }> {
  const db = unsafeAdminDb();
  const limit = Math.min(input.limit ?? 50, 100);
  const range = input.month ? riyadhMonth(input.month) : null;
  if (input.month && !range) throw errors.validation({ month: ['YYYY-MM'] });
  const q = input.q?.trim();
  const scope = and(
    isNull(tenants.deletedAt),
    input.status ? eq(invoices.status, input.status) : undefined,
    range ? and(gte(invoices.issuedAt, range[0]), lt(invoices.issuedAt, range[1])) : undefined,
    q ? ilike(invoices.invoiceNumber, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
  );
  const rows = await db.select({ invoice: invoices, tenant: tenants }).from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .where(and(scope, input.before ? lt(invoices.id, input.before) : undefined))
    .orderBy(desc(invoices.id)).limit(limit + 1);
  const [totals] = await db.select({ n: count(), total: sum(invoices.totalMinor), vat: sum(invoices.vatMinor) }).from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .where(and(scope, inArray(invoices.status, ['issued', 'paid'])));
  const page = rows.slice(0, limit);
  return {
    invoices: page.map(({ invoice, tenant }) => ({
      id: invoice.id, number: invoice.invoiceNumber, store: storeRef(tenant), status: invoice.status,
      subtotalMinor: invoice.subtotalMinor, vatMinor: invoice.vatMinor, totalMinor: invoice.totalMinor, currency: invoice.currency,
      issuedAt: invoice.issuedAt?.toISOString() ?? null, paidAt: invoice.paidAt?.toISOString() ?? null, zatcaStatus: invoice.zatcaStatus,
    })),
    next: rows.length > limit ? page.at(-1)!.invoice.id : null,
    totals: { count: Number(totals?.n ?? 0), totalMinor: Number(totals?.total ?? 0), vatMinor: Number(totals?.vat ?? 0) },
  };
}

/** ADM-19 — one invoice, as its store sees it (the merchant's own `invoiceOf`, read-only). */
export async function invoiceForStaff(staff: StaffContext, id: string): Promise<{ store: StoreRef; invoice: InvoiceDocument }> {
  const db = unsafeAdminDb();
  const [found] = await db.select({ tenant: tenants }).from(invoices).innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .where(eq(invoices.id, id)).limit(1);
  if (!found || found.tenant.deletedAt) throw errors.notFound('invoice');
  const invoice = await invoiceOf(inspectionContext(found.tenant, staff), id);
  if (!invoice) throw errors.notFound('invoice');
  return { store: storeRef(found.tenant), invoice };
}

const storeRef = (t: typeof tenants.$inferSelect): StoreRef => ({ id: t.id, name: t.name, nameAr: t.nameAr, slug: t.slug });
