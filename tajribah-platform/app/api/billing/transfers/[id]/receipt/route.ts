// API-206 — GET /api/billing/transfers/[id]/receipt: the store's own receipt (T129)
import { withBoot } from '@/server/boot';
import { transferReceiptHandler } from '@/server/modules/billing/http';

export const GET = withBoot(transferReceiptHandler);
