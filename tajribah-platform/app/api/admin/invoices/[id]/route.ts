// API-A13 — GET /api/admin/invoices/[id]
import { withBoot } from '@/server/boot';
import { invoiceForStaffHandler } from '@/server/modules/admin/http';

export const GET = withBoot(invoiceForStaffHandler);
