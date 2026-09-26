// API-A03 — GET /api/admin/stores
import { withBoot } from '@/server/boot';
import { listStoresHandler } from '@/server/modules/admin/http';

export const GET = withBoot(listStoresHandler);
