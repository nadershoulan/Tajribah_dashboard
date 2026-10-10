/**
 * T129 — bank transfers for staff («التحويلات البنكية»): every store's requests, newest first, by status, with the
 * receipt; and the decisions — approve, decline, ask for more, or a note for staff only.
 *
 * Rules that are not style choices:
 *  - **Approval is one transaction**: the subscription (plan, period, active), the store's status, a paid tax
 *    invoice for exactly the amounts the store was quoted, the payment, the request, its timeline and the store's
 *    own audit row — all or nothing. A second approval finds the request no longer open and changes nothing.
 *  - **Staff confirm the money arrived** (`confirmed: true`) before an approval is accepted — the console asks.
 *  - **The period**: `periodFor` (lib/contracts/bank-transfer.ts) — a renewal extends, a change of plan carries the
 *    paid days left over at their value.
 *  - A suspended store stays suspended: approval pays the plan, it does not undo staff's suspension.
 *  - Declining or asking for more needs words for the store; they are shown and emailed as written.
 *  - Every decision is a staff action in the staff trail, and appears in the store's own activity trail.
 */
import { and, count, desc, eq, ilike, lt, or, type SQL } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import {
  bankTransferRequests, couponRedemptions, invoices, payments, plans, subscriptionChanges, subscriptions, tenants,
  type BankTransferRequest,
} from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { TRANSFER_STATUSES, isOpen, periodFor, type TransferStatus } from '@/lib/contracts/bank-transfer';
import { priceInvoiceLines } from '@/lib/contracts/invoices';
import { formatDate } from '@/lib/format';
import { planByCode, type PlanCode } from '@/lib/plans';
import { record } from '@/server/core/audit/audit';
import { planCatalogue } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import { log } from '@/server/core/observability/log';
import { withTenant } from '@/server/core/tenancy/rls';
import { addEvent, eventsOf, planName, receiptBody, releaseCoupon, tellStore, transferView, type TransferView } from '@/server/modules/billing/bank-transfer';
import { issueInvoiceIn } from '@/server/modules/billing/invoices';
import { enqueueEdgeRefresh } from '@/server/modules/edge/publish';
import { staffLog, type StaffContext } from './access';
import { staffActingContext } from './stores';

const PAGE = 50;

export type TransferRow = {
  id: string; reference: string; status: TransferStatus; storeId: string; storeName: string; storeSlug: string;
  plan: PlanCode; cycle: 'monthly' | 'annual'; totalMinor: number; currency: string; senderName: string;
  hasReceipt: boolean; createdAt: string; decidedAt: string | null;
};
export type TransferList = { items: TransferRow[]; counts: Record<TransferStatus | 'all', number>; next: string | null };

export type TransferDetail = TransferView & {
  store: { id: string; name: string; nameAr: string | null; slug: string; status: string; crNumber: string | null; vatNumber: string | null };
  current: { plan: PlanCode | null; status: string | null; periodEnd: string | null; provider: string | null };
  staffNote: string | null;
  invoiceNumber: string | null;
  /** What approving now would grant — so staff see the period before they press. */
  preview: { start: string; end: string; extends: boolean; carriedDays: number } | null;
};

/** `status` all or one; `q` a reference, store name or sender; `before` the last row's createdAt for the next page. */
export async function listTransfers(filter: { status?: TransferStatus | 'all'; q?: string; before?: string } = {}): Promise<TransferList> {
  const db = unsafeAdminDb(); // staff read across every store (A1)
  const where: SQL[] = [];
  if (filter.status && filter.status !== 'all') where.push(eq(bankTransferRequests.status, filter.status));
  if (filter.before) {
    const before = new Date(filter.before);
    if (Number.isNaN(before.getTime())) throw errors.validation({ before: ['a date'] });
    where.push(lt(bankTransferRequests.createdAt, before));
  }
  const q = filter.q?.trim().slice(0, 80);
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(bankTransferRequests.reference, like), ilike(bankTransferRequests.senderName, like), ilike(tenants.name, like), ilike(tenants.slug, like))!);
  }
  const rows = await db.select({ r: bankTransferRequests, name: tenants.name, slug: tenants.slug })
    .from(bankTransferRequests).innerJoin(tenants, eq(tenants.id, bankTransferRequests.tenantId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(bankTransferRequests.createdAt)).limit(PAGE + 1);
  const tallies = await db.select({ status: bankTransferRequests.status, n: count() }).from(bankTransferRequests).groupBy(bankTransferRequests.status);
  const counts = Object.fromEntries([...TRANSFER_STATUSES, 'all'].map((s) => [s, 0])) as TransferList['counts'];
  for (const t of tallies) { counts[t.status] = Number(t.n); counts.all += Number(t.n); }
  const items = rows.slice(0, PAGE).map(({ r, name, slug }) => ({
    id: r.id, reference: r.reference, status: r.status, storeId: r.tenantId, storeName: name, storeSlug: slug,
    plan: r.planCode, cycle: r.billingCycle, totalMinor: r.totalMinor, currency: r.currency, senderName: r.senderName,
    hasReceipt: !!r.receiptKey, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null,
  }));
  return { items, counts, next: rows.length > PAGE ? items[items.length - 1]!.createdAt : null };
}

async function requestById(id: string): Promise<BankTransferRequest> {
  const [row] = await unsafeAdminDb().select().from(bankTransferRequests).where(eq(bankTransferRequests.id, id)).limit(1);
  if (!row) throw errors.notFound('transfer');
  return row;
}

async function storeOf(tenantId: string) {
  const [tenant] = await unsafeAdminDb().select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant || tenant.deletedAt) throw errors.notFound('store');
  return tenant;
}

/** The current subscription with its plan code and monthly price — what `periodFor` needs. */
async function currentOf(tenantId: string) {
  const [row] = await unsafeAdminDb().select({ s: subscriptions, code: plans.code, monthly: plans.priceMonthlyMinor })
    .from(subscriptions).innerJoin(plans, eq(plans.id, subscriptions.planId)).where(eq(subscriptions.tenantId, tenantId)).limit(1);
  return row ?? null;
}

export async function transferDetail(id: string, now = new Date()): Promise<TransferDetail> {
  const r = await requestById(id);
  const [tenant, current, events, catalogue] = await Promise.all([storeOf(r.tenantId), currentOf(r.tenantId), eventsOf(r.tenantId, id), planCatalogue()]);
  const [invoice] = r.invoiceId ? await unsafeAdminDb().select({ number: invoices.invoiceNumber }).from(invoices).where(eq(invoices.id, r.invoiceId)).limit(1) : [];
  const period = isOpen(r.status) ? periodFor({
    now, planCode: r.planCode, cycle: r.billingCycle, freeMonths: r.freeMonths,
    newMonthlyMinor: catalogue.find((p) => p.code === r.planCode)?.priceMonthlyMinor ?? null,
    current: current ? { planCode: current.code, status: current.s.status, periodStart: current.s.currentPeriodStart, periodEnd: current.s.currentPeriodEnd, monthlyMinor: current.monthly } : null,
  }) : null;
  return {
    ...transferView(r, events, { internal: true }),
    store: { id: tenant.id, name: tenant.name, nameAr: tenant.nameAr, slug: tenant.slug, status: tenant.status, crNumber: tenant.crNumber, vatNumber: tenant.vatNumber },
    current: { plan: current?.code ?? null, status: current?.s.status ?? null, periodEnd: current?.s.currentPeriodEnd.toISOString() ?? null, provider: current?.s.provider ?? null },
    staffNote: r.staffNote,
    invoiceNumber: invoice?.number ?? null,
    preview: period ? { start: period.start.toISOString(), end: period.end.toISOString(), extends: period.extends, carriedDays: period.carriedDays } : null,
  };
}

/** The receipt, for staff. */
export async function receiptForStaff(id: string) {
  const r = await requestById(id);
  return receiptBody(r.tenantId, id);
}

const words = (text: string | undefined, field: string, min = 5) => {
  const t = text?.trim() ?? '';
  if (t.length < min) throw errors.validation({ [field]: ['say it in a few words'] });
  if (t.length > 2000) throw errors.validation({ [field]: ['2000 characters at most'] });
  return t;
};

const CHANGE_RANK: Record<PlanCode, number> = { starter: 1, growth: 2, pro: 3, enterprise: 4 };

/**
 * Approve: the money arrived. Activates the plan for the period, issues the paid invoice, records the payment.
 */
export async function approveTransfer(staff: StaffContext, id: string, input: { confirmed: boolean; note?: string | null }, appUrl: string, now = new Date()): Promise<TransferDetail> {
  if (input.confirmed !== true) throw errors.validation({ confirmed: ['confirm that the amount reached the account first'] });
  const note = input.note?.trim().slice(0, 2000) || null;
  const request = await requestById(id);
  const tenant = await storeOf(request.tenantId);
  const ctx = staffActingContext(tenant, staff, ['billing:read', 'billing:write']);
  const catalogue = await planCatalogue();
  const plan = catalogue.find((p) => p.id === request.planId);
  if (!plan) throw errors.conflict('the plan of this request no longer exists');

  const result = await withTenant(tenant.id, async (db) => {
    const r = await db.lockById(bankTransferRequests, id);
    if (!isOpen(r.status)) throw errors.conflict(`this request is already ${r.status.replace('_', ' ')}`);
    const sub = await db.findOne(subscriptions);
    if (sub) await db.lockById(subscriptions, sub.id);
    const old = sub ? catalogue.find((p) => p.id === sub.planId) : null;
    const period = periodFor({
      now, planCode: r.planCode, cycle: r.billingCycle, freeMonths: r.freeMonths, newMonthlyMinor: plan.priceMonthlyMinor,
      current: sub && old ? { planCode: old.code, status: sub.status, periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, monthlyMinor: old.priceMonthlyMinor } : null,
    });

    const values = {
      planId: plan.id, status: 'active' as const, billingCycle: r.billingCycle, currentPeriodStart: period.start, currentPeriodEnd: period.end,
      cancelAtPeriodEnd: false, cancelledAt: null, provider: 'bank_transfer', providerSubscriptionId: null,
    };
    const subscription = sub ? await db.updateById(subscriptions, sub.id, values as never) : await db.insert(subscriptions, { id: uuidv7(), ...values } as never);
    const changeType = !old || old.code === r.planCode
      ? (old?.code === r.planCode && sub?.billingCycle !== r.billingCycle ? 'cycle_change' : 'resume')
      : CHANGE_RANK[r.planCode] > CHANGE_RANK[old.code] ? 'upgrade' : 'downgrade';
    await db.insert(subscriptionChanges, {
      id: uuidv7(), subscriptionId: subscription.id, fromPlanId: old?.id ?? null, toPlanId: plan.id, changeType,
      prorationMinor: 0, effectiveAt: now, createdBy: staff.userId,
    } as never);

    // the invoice: exactly the amounts the store was quoted, for the period it is getting
    const name = planByCode(r.planCode).name;
    const span = { en: `${formatDate(period.start, 'en')} – ${formatDate(period.end, 'en')}`, ar: `${formatDate(period.start, 'ar')} – ${formatDate(period.end, 'ar')}` };
    const lines = [{
      description: `${name.en} plan — ${r.billingCycle === 'annual' ? 'annual' : 'monthly'} (${span.en})${r.couponCode ? ` — coupon ${r.couponCode}` : ''}`,
      descriptionAr: `باقة ${name.ar} — ${r.billingCycle === 'annual' ? 'سنوي' : 'شهري'} (${span.ar})${r.couponCode ? ` — كوبون ${r.couponCode}` : ''}`,
      quantity: 1, unitPriceMinor: r.unitPriceMinor - r.discountMinor,
    }];
    const priced = priceInvoiceLines(lines);
    if (priced.totalMinor !== r.totalMinor) throw errors.conflict('the invoice would not match the amount the store was quoted — nothing was changed');
    const invoiceId = await issueInvoiceIn(db, ctx, {
      lines, subscriptionId: subscription.id, paid: true, issuedAt: now,
      buyer: r.buyerCompany && r.buyerName ? { name: r.buyerName, crNumber: r.buyerCrNumber, vatNumber: r.buyerVatNumber } : undefined,
    });
    const payment = await db.insert(payments, {
      id: uuidv7(), invoiceId, amountMinor: r.totalMinor, currency: r.currency, status: 'captured', method: 'bank_transfer',
      provider: 'bank_transfer', providerPaymentId: r.reference, idempotencyKey: `bank_transfer:${r.id}`,
      rawResponse: { reference: r.reference, senderName: r.senderName, senderBank: r.senderBank, transferredOn: r.transferredOn, approvedBy: staff.email },
    } as never);

    const t = await db.lockById(tenants, tenant.id);
    if (t.status !== 'suspended' && t.status !== 'active') await db.updateById(tenants, tenant.id, { status: 'active' } as never);

    const after = await db.updateById(bankTransferRequests, id, {
      status: 'approved', decidedBy: staff.userId, decidedAt: now, staffNote: note ?? r.staffNote, decisionMessage: null,
      subscriptionId: subscription.id, invoiceId, paymentId: payment.id, periodStart: period.start, periodEnd: period.end,
    } as never);
    const eventId = await addEvent(db, id, { type: 'approved', actor: 'staff', userId: staff.userId });
    if (note) await addEvent(db, id, { type: 'note', actor: 'staff', userId: staff.userId, message: note, internal: true });
    await record(ctx, {
      action: 'plan_change', resourceType: 'subscription', resourceId: subscription.id, actorType: 'staff',
      before: sub ? { plan: old?.code ?? null, status: sub.status, periodEnd: sub.currentPeriodEnd.toISOString() } : null,
      after: { plan: r.planCode, status: 'active', periodEnd: period.end.toISOString(), paidBy: 'bank_transfer', reference: r.reference },
    }, db);
    return { after, invoiceId, eventId, period, subscriptionId: subscription.id };
  });

  // after the commit: the coupon's redemption names its invoice; the trails; the shop's buttons; the store is told
  if (result.after.couponRedemptionId) {
    await unsafeAdminDb().update(couponRedemptions).set({ invoiceId: result.invoiceId, subscriptionId: result.subscriptionId })
      .where(eq(couponRedemptions.id, result.after.couponRedemptionId)).catch((error) => log.warn('coupon redemption not linked', { error: String(error) }));
  }
  await staffLog(staff, {
    action: 'bank_transfer.approve', targetType: 'bank_transfer', targetId: id, storeId: tenant.id, reason: note,
    detail: { reference: request.reference, plan: request.planCode, cycle: request.billingCycle, totalMinor: request.totalMinor, periodEnd: result.period.end.toISOString(), invoiceId: result.invoiceId },
  });
  await enqueueEdgeRefresh(tenant.id); // the plan's features reach the shop's buttons
  const name = planName(request.planCode);
  await tellStore(tenant.id, result.eventId, {
    type: 'transfer.approved', level: 'info', href: `/dashboard/billing/invoices/${result.invoiceId}`,
    title: { ar: 'تم تفعيل اشتراكك', en: 'Your plan is on' },
    body: { ar: `باقة ${name.ar} حتى ${formatDate(result.period.end, 'ar')}. فاتورتك جاهزة.`, en: `${name.en} until ${formatDate(result.period.end, 'en')}. Your invoice is ready.` },
    email: (to) => sendEmail(to.email, EMAIL.transferApproved, {
      store: tenant.name, reference: request.reference, plan: name, until: result.period.end, link: `${appUrl}/dashboard/billing/invoices/${result.invoiceId}`,
    }, to.locale),
  });
  return transferDetail(id, now);
}

/** Decline, with words for the store. A held coupon is given back. The receipt is kept, as the record. */
export async function rejectTransfer(staff: StaffContext, id: string, input: { message: string; note?: string | null }, appUrl: string, now = new Date()): Promise<TransferDetail> {
  const message = words(input.message, 'message');
  const note = input.note?.trim().slice(0, 2000) || null;
  const request = await requestById(id);
  const tenant = await storeOf(request.tenantId);
  const { after, eventId } = await withTenant(tenant.id, async (db) => {
    const r = await db.lockById(bankTransferRequests, id);
    if (!isOpen(r.status)) throw errors.conflict(`this request is already ${r.status.replace('_', ' ')}`);
    const row = await db.updateById(bankTransferRequests, id, { status: 'rejected', decisionMessage: message, staffNote: note ?? r.staffNote, decidedBy: staff.userId, decidedAt: now } as never);
    const ev = await addEvent(db, id, { type: 'rejected', actor: 'staff', userId: staff.userId, message });
    if (note) await addEvent(db, id, { type: 'note', actor: 'staff', userId: staff.userId, message: note, internal: true });
    return { after: row, eventId: ev };
  });
  if (after.couponRedemptionId) await releaseCoupon(after.couponRedemptionId);
  await staffLog(staff, { action: 'bank_transfer.reject', targetType: 'bank_transfer', targetId: id, storeId: tenant.id, reason: message, detail: { reference: request.reference } });
  await tellStore(tenant.id, eventId, {
    type: 'transfer.rejected', level: 'error',
    title: { ar: `تعذّر قبول التحويل ${request.reference}`, en: `Transfer ${request.reference} could not be accepted` },
    body: { ar: message, en: message },
    email: (to) => sendEmail(to.email, EMAIL.transferRejected, { store: tenant.name, reference: request.reference, reason: message, link: `${appUrl}/dashboard/billing` }, to.locale),
  });
  return transferDetail(id, now);
}

/** Ask the store for more (a clearer receipt, the sender's name as the bank shows it). */
export async function requestTransferInfo(staff: StaffContext, id: string, input: { message: string }, appUrl: string, now = new Date()): Promise<TransferDetail> {
  const message = words(input.message, 'message');
  const request = await requestById(id);
  const tenant = await storeOf(request.tenantId);
  const eventId = await withTenant(tenant.id, async (db) => {
    const r = await db.lockById(bankTransferRequests, id);
    if (r.status !== 'pending') throw errors.conflict('only a request under review can be sent back for more');
    await db.updateById(bankTransferRequests, id, { status: 'info_requested', decisionMessage: message } as never);
    return addEvent(db, id, { type: 'info_requested', actor: 'staff', userId: staff.userId, message });
  });
  await staffLog(staff, { action: 'bank_transfer.request_info', targetType: 'bank_transfer', targetId: id, storeId: tenant.id, reason: message, detail: { reference: request.reference } });
  await tellStore(tenant.id, eventId, {
    type: 'transfer.info_requested', level: 'warning',
    title: { ar: `نحتاج معلومة إضافية عن التحويل ${request.reference}`, en: `We need a little more about transfer ${request.reference}` },
    body: { ar: message, en: message },
    email: (to) => sendEmail(to.email, EMAIL.transferInfoRequested, { store: tenant.name, reference: request.reference, message, link: `${appUrl}/dashboard/billing` }, to.locale),
  });
  return transferDetail(id, now);
}

/** A note for staff only, on the timeline (any status). */
export async function noteTransfer(staff: StaffContext, id: string, input: { note: string }): Promise<TransferDetail> {
  const note = words(input.note, 'note', 2);
  const request = await requestById(id);
  await withTenant(request.tenantId, async (db) => {
    await db.lockById(bankTransferRequests, id);
    await db.updateById(bankTransferRequests, id, { staffNote: note } as never);
    await addEvent(db, id, { type: 'note', actor: 'staff', userId: staff.userId, message: note, internal: true });
  });
  await staffLog(staff, { action: 'bank_transfer.note', targetType: 'bank_transfer', targetId: id, storeId: request.tenantId, detail: { reference: request.reference } });
  return transferDetail(id);
}

/** Open requests waiting on staff (the console's count). */
export async function pendingTransferCount(): Promise<number> {
  const [row] = await unsafeAdminDb().select({ n: count() }).from(bankTransferRequests).where(eq(bankTransferRequests.status, 'pending'));
  return Number(row?.n ?? 0);
}

