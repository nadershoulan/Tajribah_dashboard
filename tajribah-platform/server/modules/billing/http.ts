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
