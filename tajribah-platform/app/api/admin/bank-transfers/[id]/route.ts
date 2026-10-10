// API-A75 — GET /api/admin/bank-transfers/[id]: one request in full (T129)
import { withBoot } from '@/server/boot';
import { transferDetailHandler } from '@/server/modules/admin/http';

export const GET = withBoot(transferDetailHandler);
