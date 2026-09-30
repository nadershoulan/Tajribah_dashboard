// API-088 — GET /api/agency/stores (T62)
import { withBoot } from '@/server/boot';
import { storesOverviewHandler } from '@/server/modules/agency/http';

export const GET = withBoot(storesOverviewHandler);
