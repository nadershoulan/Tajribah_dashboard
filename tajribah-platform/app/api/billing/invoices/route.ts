// API-130 — GET /api/billing/invoices
import { withBoot } from '@/server/boot';
import { listInvoicesHandler } from '@/server/modules/billing/http';

export const GET = withBoot(listInvoicesHandler);
