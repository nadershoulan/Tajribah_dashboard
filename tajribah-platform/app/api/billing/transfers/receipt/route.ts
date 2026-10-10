// API-201 — POST /api/billing/transfers/receipt: where to upload a transfer receipt (T129)
import { withBoot } from '@/server/boot';
import { startReceiptHandler } from '@/server/modules/billing/http';

export const POST = withBoot(startReceiptHandler);
