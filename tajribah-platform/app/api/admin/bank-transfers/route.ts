// API-A73 — GET /api/admin/bank-transfers: every store's transfer requests (T129)
import { withBoot } from '@/server/boot';
import { listTransfersHandler } from '@/server/modules/admin/http';

export const GET = withBoot(listTransfersHandler);
