/**
 * T129 — paying for a plan by bank transfer, the store's side: upload the receipt, send the request, send it again
 * when staff ask for more, cancel it, see where it stands. Staff decide in the admin console
 * (`server/modules/admin/bank-transfers.ts`); both sides share the views and notices here.
 *
 * Rules that are not style choices:
 *  - **The server prices the request**, from the plan rows and the coupon, never from the browser — and keeps the
 *    amounts as quoted, so a later price change never changes what the store paid for.
 *  - **One open request per store** — the database's partial unique index is the guarantee.
 *  - **A coupon is held from the moment the request is sent** (redeemed, so the last use cannot go to two stores),
 *    and given back if the request is declined or cancelled.
 *  - **The receipt is judged by its own bytes** (PNG, JPEG, WebP, PDF; 10 MB), stored under the store's prefix with
 *    an unguessable key that never leaves the server, and served only to the store and to staff, through the
 *    server, as an attachment-safe response.
 *  - Every step tells someone: the store in-app and by email (its billing people, in their language), and staff by
 *    email.
 */
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { bankTransferEvents, bankTransferRequests, couponRedemptions, users, type BankTransferEvent, type BankTransferRequest } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import {
  OPEN_STATUSES, RECEIPT_MAX_BYTES, RECEIPT_MIN_BYTES, RECEIPT_TYPES, formatIban, isOpen, referenceFrom, sniffReceipt,
  type ReceiptType, type TransferEventType, type TransferEventView, type TransferView,
} from '@/lib/contracts/bank-transfer';

export type { TransferEventView, TransferView };
import { priceInvoiceLines } from '@/lib/contracts/invoices';
import { CR_NUMBER, VAT_NUMBER } from '@/lib/contracts/settings';
import type { Bi, Lang } from '@/lib/lang';
import { formatMoney } from '@/lib/money';
import { planByCode, type PlanCode } from '@/lib/plans';
import { planCatalogue } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import { log } from '@/server/core/observability/log';
import { LIMITS, rateLimiter } from '@/server/core/ratelimit/limiter';
import { forTenant } from '@/server/core/storage/storage';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { EXPIRED, notePendingUpload, takePendingUpload } from '@/server/modules/uploads/pending';
import { checkCoupon, redeemCoupon } from './coupons';
import { announce } from './notices';
import { assertTransferAccount, bankTransferSettings } from './payment-methods';

/** How long a receipt upload URL lives. */
const UPLOAD_SECONDS = 15 * 60;

// ------------------------------------------------------------------ views

export function transferView(r: BankTransferRequest, events: BankTransferEvent[], { internal }: { internal: boolean }): TransferView {
  return {
    id: r.id, reference: r.reference, status: r.status, plan: r.planCode, cycle: r.billingCycle,
    unitPriceMinor: r.unitPriceMinor, discountMinor: r.discountMinor, couponCode: r.couponCode, freeMonths: r.freeMonths,
    subtotalMinor: r.subtotalMinor, vatMinor: r.vatMinor, totalMinor: r.totalMinor, currency: r.currency,
    bank: { ...r.bankSnapshot, ibanDisplay: formatIban(r.bankSnapshot.iban) },
    senderName: r.senderName, senderBank: r.senderBank, transferredOn: r.transferredOn,
    receipt: r.receiptKey ? { type: r.receiptType ?? 'application/octet-stream', bytes: r.receiptBytes ?? 0, name: r.receiptName } : null,
    company: r.buyerCompany && r.buyerName ? { name: r.buyerName, vatNumber: r.buyerVatNumber, crNumber: r.buyerCrNumber } : null,
    note: r.merchantNote, decisionMessage: r.decisionMessage, decidedAt: r.decidedAt?.toISOString() ?? null,
    invoiceId: r.invoiceId, periodEnd: r.periodEnd?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    events: events.filter((e) => internal || !e.internal).map((e) => ({
      id: e.id, type: e.type, actor: e.actorType as TransferEventView['actor'], message: e.message, internal: e.internal, at: e.createdAt.toISOString(),
    })),
  };
}

/** One event on a request's timeline, in the caller's transaction. Returns its id (notices name it). */
export async function addEvent(db: TenantDb, requestId: string, input: { type: TransferEventType; actor: 'store' | 'staff' | 'system'; userId?: string | null; message?: string | null; internal?: boolean }): Promise<string> {
  const id = uuidv7();
  await db.insert(bankTransferEvents, {
    id, requestId, type: input.type, actorType: input.actor, actorUserId: input.userId ?? null,
    message: input.message ?? null, internal: input.internal ?? false,
  } as never);
  return id;
}

// ------------------------------------------------------------------ notices

const money = (minor: number, currency: string): Bi => ({ ar: formatMoney(minor, currency, 'ar'), en: formatMoney(minor, currency, 'en') });
export const planName = (code: PlanCode): Bi => planByCode(code).name;

/** Tajribah's staff accounts and the extra addresses set on bank transfer — who hears about transfers to check. */
export async function staffRecipients(): Promise<{ email: string; locale: Lang }[]> {
  const staff = await unsafeAdminDb().select({ email: users.email, locale: users.locale }).from(users)
    .where(and(eq(users.isStaff, true), isNull(users.deletedAt)));
  const extra = (await bankTransferSettings()).notifyEmails;
  const seen = new Set<string>();
  return [...staff, ...extra.map((email) => ({ email, locale: 'ar' as Lang }))].filter((r) => {
    const k = r.email.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function tellStaff(kind: 'new' | 'resubmitted' | 'cancelled', r: BankTransferRequest, store: string, appUrl: string): Promise<void> {
  const total = money(r.totalMinor, r.currency);
  for (const to of await staffRecipients()) {
    await sendEmail(to.email, EMAIL.transferForStaff, {
      kind, store, reference: r.reference, plan: planName(r.planCode), total: total[to.locale], sender: r.senderName,
      link: `${appUrl}/admin/bank-transfers?open=${r.id}`,
    }, to.locale).catch((error) => log.warn('staff transfer email failed', { reference: r.reference, error: String(error) }));
  }
}

/** The store's billing people: in-app once per event, then email. */
export async function tellStore(tenantId: string, event: string, input: {
  type: string; title: Bi; body: Bi; level: 'info' | 'warning' | 'error'; href?: string;
  email: (to: { email: string; locale: Lang }) => Promise<void>;
}): Promise<void> {
  await announce(tenantId, { ...input, href: input.href ?? `/dashboard/billing?transfer-event=${event}` })
    .catch((error) => log.warn('transfer notice failed', { tenantId, type: input.type, error: String(error) }));
}

// ------------------------------------------------------------------ the receipt

const receiptKeyPattern = (tenantId: string) => new RegExp(`^t/${tenantId}/receipt/[0-9a-f-]{36}/receipt\\.(png|jpg|webp|pdf)$`);

/** A presigned upload for the receipt; the bytes are judged when the request is sent. */
export async function startReceiptUpload(ctx: TenantContext, input: { filename: string; contentType: string; sizeBytes: number }): Promise<{ key: string; uploadUrl: string; contentType: string; expiresAt: string }> {
  ctx.require('billing:write');
  const limit = await rateLimiter().hit(`bank-transfer:${ctx.tenantId}`, LIMITS.bankTransfer.limit, LIMITS.bankTransfer.windowSeconds);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);
  const ext = RECEIPT_TYPES[input.contentType as ReceiptType];
  const problems: Record<string, string[]> = {};
  if (!ext) problems.contentType = ['a receipt is a PNG, JPEG, WebP picture or a PDF'];
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < RECEIPT_MIN_BYTES) problems.sizeBytes = ['the file is empty'];
  else if (input.sizeBytes > RECEIPT_MAX_BYTES) problems.sizeBytes = ['a receipt is 10 MB at most'];
  if (Object.keys(problems).length) throw errors.validation(problems);
  const store = forTenant(ctx.tenantId);
  const key = store.key({ kind: 'receipt', id: uuidv7(), filename: `receipt.${ext}` });
  await notePendingUpload(ctx.tenantId, key, 'transfer_receipt'); // never sent with a request: swept after a day
  const { url, expiresAt } = await store.presignUpload(key, { contentType: input.contentType, sizeBytes: input.sizeBytes, expiresInSeconds: UPLOAD_SECONDS });
  return { key, uploadUrl: url, contentType: input.contentType, expiresAt: expiresAt.toISOString() };
}

/** The uploaded receipt's type and size, judged by its bytes; refused bytes are deleted. */
async function checkReceipt(ctx: TenantContext, key: string): Promise<{ type: ReceiptType; bytes: number }> {
  if (!receiptKeyPattern(ctx.tenantId).test(key)) throw errors.validation({ receipt: ['upload the receipt again'] });
  const store = forTenant(ctx.tenantId);
  const head = await store.head(key);
  if (!head) throw errors.validation({ receipt: ['the receipt has not arrived yet — upload it again'] });
  const refuse = async (message: string) => {
    await withTenant(ctx.tenantId, (db) => takePendingUpload(db, key));
    await store.delete(key);
    throw errors.validation({ receipt: [message] });
  };
  if (head.size > RECEIPT_MAX_BYTES) return refuse('a receipt is 10 MB at most');
  if (head.size < RECEIPT_MIN_BYTES) return refuse('the file is empty');
  const object = await store.get(key);
  const bytes = object ? new Uint8Array(await new Response(object.body).arrayBuffer()) : new Uint8Array();
  const type = sniffReceipt(bytes.subarray(0, 16));
  if (!type) return refuse('a receipt is a PNG, JPEG, WebP picture or a PDF');
  return { type, bytes: head.size };
}

/** The receipt's bytes for the store (its own) or staff — never another store's. */
export async function receiptBody(tenantId: string, requestId: string): Promise<{ body: ReadableStream; type: string; name: string }> {
  const request = await withTenant(tenantId, (db) => db.findById(bankTransferRequests, requestId));
  if (!request?.receiptKey) throw errors.notFound('receipt');
  const object = await forTenant(tenantId).get(request.receiptKey);
  if (!object) throw errors.notFound('receipt');
  const ext = request.receiptKey.split('.').pop() ?? 'bin';
  return { body: object.body, type: request.receiptType ?? 'application/octet-stream', name: `${request.reference}-receipt.${ext}` };
}

/** A stored receipt as a response: never rendered as a page on our own address (PDF and SVG tricks). */
export function receiptResponse(file: { body: ReadableStream; type: string; name: string }, download: boolean): Response {
  return new Response(file.body, {
    headers: {
      'content-type': file.type,
      'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${file.name}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'cache-control': 'private, no-store',
    },
  });
}

// ------------------------------------------------------------------ the request

export type SubmitTransferInput = {
  plan: PlanCode; cycle: 'monthly' | 'annual'; couponCode?: string | null;
  bankAccountId: string; senderName: string; senderBank?: string | null; transferredOn?: string | null;
  receiptKey?: string | null; receiptName?: string | null;
  company?: { name: string; vatNumber?: string | null; crNumber?: string | null } | null;
  note?: string | null;
};

const clean = (v: string | null | undefined, max: number) => {
  const t = v?.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
};

/** The day the money went, `YYYY-MM-DD`, not in the future (Riyadh) nor over 60 days ago. */
function transferDay(value: string | null | undefined, now: Date): string | null | 'bad' {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'bad';
  const day = new Date(`${value}T00:00:00+03:00`);
  if (Number.isNaN(day.getTime())) return 'bad';
  const riyadhToday = new Date(new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10) + 'T00:00:00+03:00');
  if (day.getTime() > riyadhToday.getTime() || riyadhToday.getTime() - day.getTime() > 60 * 86_400_000) return 'bad';
  return value;
}

function checkSender(input: { senderName?: string; senderBank?: string | null; transferredOn?: string | null; note?: string | null }, now: Date, problems: Record<string, string[]>) {
  const senderName = clean(input.senderName, 140);
  if (input.senderName !== undefined && (!senderName || senderName.length < 3)) problems.senderName = ['the name on the account the money came from'];
  const day = transferDay(input.transferredOn, now);
  if (day === 'bad') problems.transferredOn = ['the day you sent it — today or up to 60 days ago'];
  const note = clean(input.note, 1000);
  return { senderName, senderBank: clean(input.senderBank, 80), transferredOn: day === 'bad' ? null : day, note };
}

/** A reference no store has yet (unique across stores, so looked up through the admin handle). */
async function newReference(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const ref = referenceFrom(crypto.getRandomValues(new Uint8Array(6)));
    if (!(await unsafeAdminDb().select({ id: bankTransferRequests.id }).from(bankTransferRequests).where(eq(bankTransferRequests.reference, ref)).limit(1)).length) return ref;
  }
  throw errors.conflict('try again in a moment');
}

const OPEN_CONFLICT = 'your store already has a transfer under review — follow it on the Billing page, or cancel it first';

/** Send a bank transfer request. */
export async function submitTransfer(ctx: TenantContext, input: SubmitTransferInput, appUrl: string, now = new Date()): Promise<TransferView> {
  ctx.require('billing:write');
  const limit = await rateLimiter().hit(`bank-transfer:${ctx.tenantId}`, LIMITS.bankTransfer.limit, LIMITS.bankTransfer.windowSeconds);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);
  // first, the thing the store most needs to hear: it already has one open
  if (await withTenant(ctx.tenantId, (db) => db.exists(bankTransferRequests, inArray(bankTransferRequests.status, [...OPEN_STATUSES])))) throw errors.conflict(OPEN_CONFLICT);

  const problems: Record<string, string[]> = {};
  const sender = checkSender(input, now, problems);
  if (input.senderName === undefined) problems.senderName = ['the name on the account the money came from'];
  let company: { name: string; vatNumber: string | null; crNumber: string | null } | null = null;
  if (input.company) {
    const name = clean(input.company.name, 200);
    const vat = VAT_NUMBER.safeParse(input.company.vatNumber ?? null);
    const cr = CR_NUMBER.safeParse(input.company.crNumber ?? null);
    if (!name || name.length < 2) problems.companyName = ['the company’s legal name'];
    if (!vat.success) problems.companyVat = [vat.error.issues[0]!.message];
    if (!cr.success) problems.companyCr = [cr.error.issues[0]!.message];
    if (name && vat.success && cr.success) company = { name, vatNumber: vat.data, crNumber: cr.data };
  }
  const config = await bankTransferSettings();
  if (config.receiptRequired && !input.receiptKey) problems.receipt = ['attach the transfer receipt'];
  const prices = (await planCatalogue()).find((p) => p.code === input.plan && p.isPublic);
  const unit = input.cycle === 'annual' ? prices?.priceAnnualMinor : prices?.priceMonthlyMinor;
  if (!prices || unit == null) problems.plan = ['this plan is not sold by transfer — talk to us'];
  if (Object.keys(problems).length) throw errors.validation(problems);

  const account = await assertTransferAccount(input.bankAccountId);

  // the coupon, as the checkout showed it — checked again here, on the server
  const coupon = input.couponCode?.trim() ? await checkCoupon(ctx, { code: input.couponCode, plan: input.plan, cycle: input.cycle }, now) : null;
  const name = planByCode(input.plan).name;
  const priced = priceInvoiceLines([{ description: `${name.en} — ${input.cycle}`, descriptionAr: name.ar, quantity: 1, unitPriceMinor: unit! - (coupon?.discountMinor ?? 0) }]);
  const receipt = input.receiptKey ? await checkReceipt(ctx, input.receiptKey) : null;

  const id = uuidv7();
  // held now, so the last use of a coupon cannot go to two stores; given back if this is declined or cancelled
  const redemptionId = coupon
    ? await redeemCoupon(ctx, { code: coupon.code, plan: input.plan, cycle: input.cycle, discountMinor: coupon.discountMinor }, now)
    : null;
  const reference = await newReference(); // before the transaction: it looks across stores
  let row: BankTransferRequest;
  try {
    row = await withTenant(ctx.tenantId, async (db) => {
      if (input.receiptKey && !(await takePendingUpload(db, input.receiptKey))) throw errors.conflict(EXPIRED);
      const inserted = await db.insert(bankTransferRequests, {
        id, reference, status: 'pending', planId: prices!.id, planCode: input.plan, billingCycle: input.cycle,
        unitPriceMinor: unit!, discountMinor: coupon?.discountMinor ?? 0, couponCode: coupon?.code ?? null, freeMonths: coupon?.freeMonths ?? 0,
        couponRedemptionId: redemptionId, subtotalMinor: priced.subtotalMinor, vatMinor: priced.vatMinor, totalMinor: priced.totalMinor,
        currency: prices!.currency, bankAccountId: account.id,
        bankSnapshot: { bankName: account.bankName, bankNameAr: account.bankNameAr, accountHolder: account.accountHolder, accountNumber: account.accountNumber, iban: account.iban },
        senderName: sender.senderName!, senderBank: sender.senderBank, transferredOn: sender.transferredOn,
        receiptKey: input.receiptKey ?? null, receiptType: receipt?.type ?? null, receiptBytes: receipt?.bytes ?? null,
        receiptName: clean(input.receiptName, 120),
        buyerCompany: !!company, buyerName: company?.name ?? null, buyerVatNumber: company?.vatNumber ?? null, buyerCrNumber: company?.crNumber ?? null,
        merchantNote: sender.note, submittedBy: ctx.actor.userId,
      } as never);
      await addEvent(db, id, { type: 'submitted', actor: 'store', userId: ctx.actor.userId, message: sender.note });
      return inserted;
    });
  } catch (error) {
    if (redemptionId) await releaseCoupon(redemptionId);
    if (/bank_transfer_one_open_unq/.test(String((error as Error)?.message)) || /bank_transfer_one_open_unq/.test(String((error as { cause?: Error })?.cause?.message))) throw errors.conflict(OPEN_CONFLICT);
    throw error;
  }

  const total = money(row.totalMinor, row.currency);
  await tellStore(ctx.tenantId, id, {
    type: 'transfer.submitted', level: 'info',
    title: { ar: `استلمنا طلب التحويل ${row.reference}`, en: `We have your transfer request ${row.reference}` },
    body: { ar: `نراجعه خلال ${config.reviewHours} ساعة تقريباً ونفعّل اشتراكك فور التحقق.`, en: `We check it within about ${config.reviewHours} hours and switch your plan on once it is confirmed.` },
    email: (to) => sendEmail(to.email, EMAIL.transferSubmitted, {
      store: ctx.tenant.name, reference: row.reference, plan: name, total: total[to.locale],
      bank: to.locale === 'ar' ? account.bankNameAr : account.bankName, iban: formatIban(account.iban), hours: config.reviewHours,
      link: `${appUrl}/dashboard/billing`,
    }, to.locale),
  });
  await tellStaff('new', row, ctx.tenant.name, appUrl);
  return transferView(row, await eventsOf(ctx.tenantId, id), { internal: false });
}

/** After staff asked for more: the store corrects the sender, adds a receipt or a note, and sends it again. */
export async function resubmitTransfer(ctx: TenantContext, id: string, input: { senderName?: string; senderBank?: string | null; transferredOn?: string | null; receiptKey?: string | null; receiptName?: string | null; note?: string | null }, appUrl: string, now = new Date()): Promise<TransferView> {
  ctx.require('billing:write');
  const problems: Record<string, string[]> = {};
  const sender = checkSender(input, now, problems);
  if (Object.keys(problems).length) throw errors.validation(problems);
  const receipt = input.receiptKey ? await checkReceipt(ctx, input.receiptKey) : null;
  const { row, replaced } = await withTenant(ctx.tenantId, async (db) => {
    const before = await db.lockById(bankTransferRequests, id);
    if (before.status !== 'info_requested') throw errors.conflict('this request is not waiting for anything from you');
    if (input.receiptKey && !(await takePendingUpload(db, input.receiptKey))) throw errors.conflict(EXPIRED);
    const patch: Partial<BankTransferRequest> = { status: 'pending' };
    if (sender.senderName) patch.senderName = sender.senderName;
    if (input.senderBank !== undefined) patch.senderBank = sender.senderBank;
    if (input.transferredOn !== undefined) patch.transferredOn = sender.transferredOn;
    if (input.receiptKey && receipt) Object.assign(patch, { receiptKey: input.receiptKey, receiptType: receipt.type, receiptBytes: receipt.bytes, receiptName: clean(input.receiptName, 120) });
    const after = await db.updateById(bankTransferRequests, id, patch as never);
    await addEvent(db, id, { type: 'resubmitted', actor: 'store', userId: ctx.actor.userId, message: sender.note ?? (input.receiptKey ? 'receipt replaced' : null) });
    return { row: after, replaced: input.receiptKey && before.receiptKey && before.receiptKey !== input.receiptKey ? before.receiptKey : null };
  });
  if (replaced) await forTenant(ctx.tenantId).delete(replaced).catch(() => undefined); // the new receipt is the evidence now
  await tellStaff('resubmitted', row, ctx.tenant.name, appUrl);
  return transferView(row, await eventsOf(ctx.tenantId, id), { internal: false });
}

/** The store changes its mind while the request is open; a held coupon is given back. */
export async function cancelTransfer(ctx: TenantContext, id: string, appUrl: string): Promise<TransferView> {
  ctx.require('billing:write');
  const row = await withTenant(ctx.tenantId, async (db) => {
    const before = await db.lockById(bankTransferRequests, id);
    if (!isOpen(before.status)) throw errors.conflict('only a request under review can be cancelled');
    const after = await db.updateById(bankTransferRequests, id, { status: 'cancelled' } as never);
    await addEvent(db, id, { type: 'cancelled', actor: 'store', userId: ctx.actor.userId });
    return after;
  });
  if (row.couponRedemptionId) await releaseCoupon(row.couponRedemptionId);
  await tellStaff('cancelled', row, ctx.tenant.name, appUrl);
  return transferView(row, await eventsOf(ctx.tenantId, id), { internal: false });
}

/** A coupon held by a request that will not be paid goes back (the code may be used again). */
export async function releaseCoupon(redemptionId: string): Promise<void> {
  await unsafeAdminDb().delete(couponRedemptions).where(eq(couponRedemptions.id, redemptionId))
    .catch((error) => log.warn('coupon release failed', { redemptionId, error: String(error) }));
}

export async function eventsOf(tenantId: string, requestId: string): Promise<BankTransferEvent[]> {
  return withTenant(tenantId, (db) => db.find(bankTransferEvents, eq(bankTransferEvents.requestId, requestId), { limit: 200, orderBy: asc(bankTransferEvents.createdAt) }));
}

/** This store's requests, newest first, with their timelines (staff notes left out). */
export async function transfersOf(ctx: TenantContext, limit = 10): Promise<TransferView[]> {
  ctx.require('billing:read');
  return withTenant(ctx.tenantId, async (db) => {
    const rows = await db.find(bankTransferRequests, undefined, { limit, orderBy: desc(bankTransferRequests.createdAt) });
    if (!rows.length) return [];
    const events = await db.find(bankTransferEvents, inArray(bankTransferEvents.requestId, rows.map((r) => r.id)), { limit: 500, orderBy: asc(bankTransferEvents.createdAt) });
    return rows.map((r) => transferView(r, events.filter((e) => e.requestId === r.id), { internal: false }));
  });
}
