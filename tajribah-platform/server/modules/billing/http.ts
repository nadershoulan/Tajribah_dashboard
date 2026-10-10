/**
 * P2.6 — invoices, read side. Issuing is not an endpoint: an invoice follows a payment
 * (P2.4/P2.5), inside the server. Both need `billing:read` (owner and admin).
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { PLAN_CODE } from '@/db/schema';
import { checkCoupon } from './coupons';
import { errors } from '@/server/core/errors/problem';
import { invoiceOf, invoicesOf } from './invoices';
import { creditSummary } from './credits';
import { billingSummary } from './summary';
import { cancelTransfer, receiptBody, receiptResponse, resubmitTransfer, startReceiptUpload, submitTransfer, transfersOf } from './bank-transfer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** API-130 — GET /api/billing/invoices: this store's invoices, newest first. */
export const listInvoicesHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ invoices: await invoicesOf(ctx) });
});

/** API-131 — GET /api/billing/invoices/[id]: one invoice as issued, with its lines. */
export const getInvoiceHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  const id = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  const invoice = UUID.test(id) ? await invoiceOf(ctx, id) : null;
  if (!invoice) throw errors.notFound('invoice');
  return json(invoice);
});

/** API-132 — GET /api/billing/credits: AI credits — balance, this month's grant and use, recent entries (P2.9). */
export const creditsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await creditSummary(ctx));
});

/** API-133 — GET /api/billing: plan, status, prices, AI credits and invoices for the billing screen (P2.10). */
export const billingHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await billingSummary(ctx));
});

/** API-134 — POST /api/billing/coupons/check { code, plan, cycle }: may this store use it, and what does it take off (P2.12). */
export const checkCouponHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.object({
    code: z.string().trim().min(1).max(40), plan: z.enum(PLAN_CODE), cycle: z.enum(['monthly', 'annual']),
  }));
  return json(await checkCoupon(ctx, body));
});

// ------------------------------------------------------------------ T129: bank transfer

const CYCLE = z.enum(['monthly', 'annual']);
const text = (max: number) => z.string().max(max);
const transferId = (request: Request, fromEnd = 0) => {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 1 - fromEnd] ?? '';
  if (!UUID.test(id)) throw errors.notFound('transfer');
  return id;
};

/** API-201 — POST /api/billing/transfers/receipt { filename, contentType, sizeBytes }: where to upload the receipt (T129). */
export const startReceiptHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.object({ filename: text(200), contentType: text(100), sizeBytes: z.number().int() }));
  return json(await startReceiptUpload(ctx, body), { status: 201 });
});

/** API-202 — GET /api/billing/transfers: this store's transfer requests, newest first. */
export const listTransfersHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ transfers: await transfersOf(ctx, 20) });
});

/** API-203 — POST /api/billing/transfers: send a bank transfer request for a plan. */
export const submitTransferHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.object({
    plan: z.enum(PLAN_CODE), cycle: CYCLE, couponCode: text(40).nullable().optional(),
    bankAccountId: z.string().uuid(), senderName: text(200), senderBank: text(120).nullable().optional(),
    transferredOn: text(10).nullable().optional(), receiptKey: text(300).nullable().optional(), receiptName: text(200).nullable().optional(),
    company: z.object({ name: text(300), vatNumber: text(40).nullable().optional(), crNumber: text(40).nullable().optional() }).nullable().optional(),
    note: text(1500).nullable().optional(),
  }));
  return json(await submitTransfer(ctx, body, config.appUrl), { status: 201 });
});

/** API-204 — PATCH /api/billing/transfers/[id]: send it again with what staff asked for. */
export const resubmitTransferHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.object({
    senderName: text(200).optional(), senderBank: text(120).nullable().optional(), transferredOn: text(10).nullable().optional(),
    receiptKey: text(300).nullable().optional(), receiptName: text(200).nullable().optional(), note: text(1500).nullable().optional(),
  }));
  return json(await resubmitTransfer(ctx, transferId(request), body, config.appUrl));
});

/** API-205 — DELETE /api/billing/transfers/[id]: cancel a request still under review. */
export const cancelTransferHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  return json(await cancelTransfer(ctx, transferId(request), config.appUrl));
});

/** API-206 — GET /api/billing/transfers/[id]/receipt[?download=1]: the store's own receipt. */
export const transferReceiptHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  ctx.require('billing:read');
  const file = await receiptBody(ctx.tenantId, transferId(request, 1));
  return receiptResponse(file, new URL(request.url).searchParams.get('download') === '1');
});
