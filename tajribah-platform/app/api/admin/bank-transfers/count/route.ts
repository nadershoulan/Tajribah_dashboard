// API-A74 — GET /api/admin/bank-transfers/count: requests waiting on staff (T129)
import { withBoot } from '@/server/boot';
import { pendingTransfersHandler } from '@/server/modules/admin/http';

export const GET = withBoot(pendingTransfersHandler);
