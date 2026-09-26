// API-A04 — GET /api/admin/stores/[id]
import { withBoot } from '@/server/boot';
import { storeDetailHandler } from '@/server/modules/admin/http';

export const GET = withBoot(storeDetailHandler);
