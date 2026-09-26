/**
 * P2.6 — invoices, read side. Issuing is not an endpoint: an invoice follows a payment
 * (P2.4/P2.5), inside the server. Both need `billing:read` (owner and admin).
 */
import { route } from '@/server/core/observability/request';
import { json, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { invoiceOf, invoicesOf } from './invoices';

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
