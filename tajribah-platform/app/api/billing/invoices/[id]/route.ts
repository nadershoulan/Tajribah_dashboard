// API-131 — GET /api/billing/invoices/[id]
import { withBoot } from '@/server/boot';
import { getInvoiceHandler } from '@/server/modules/billing/http';

export const GET = withBoot(getInvoiceHandler);
