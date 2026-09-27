// API-120 — GET /api/analytics?range=
import { withBoot } from '@/server/boot';
import { analyticsHandler } from '@/server/modules/analytics/http';

export const GET = withBoot(analyticsHandler);
