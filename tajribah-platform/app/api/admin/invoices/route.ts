// API-A12 — GET /api/admin/invoices
import { withBoot } from '@/server/boot';
import { listInvoicesHandler } from '@/server/modules/admin/http';

export const GET = withBoot(listInvoicesHandler);
