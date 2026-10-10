// API-202/203 — GET, POST /api/billing/transfers: bank transfer requests (T129)
import { withBoot } from '@/server/boot';
import { listTransfersHandler, submitTransferHandler } from '@/server/modules/billing/http';

export const GET = withBoot(listTransfersHandler);
export const POST = withBoot(submitTransferHandler);
