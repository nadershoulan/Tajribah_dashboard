// API-090 — GET /api/dashboard
import { withBoot } from '@/server/boot';
import { dashboardHandler } from '@/server/modules/dashboard/http';

export const GET = withBoot(dashboardHandler);
