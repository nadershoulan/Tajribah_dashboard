// API-A77 — GET /api/admin/bank-transfers/[id]/receipt: the receipt, for staff (T129)
import { withBoot } from '@/server/boot';
import { transferReceiptForStaffHandler } from '@/server/modules/admin/http';

export const GET = withBoot(transferReceiptForStaffHandler);
