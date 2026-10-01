// API-125 — GET /api/analytics/sessions/[id] (P4.10: one visit's path)
import { withBoot } from '@/server/boot';
import { analyticsSessionHandler } from '@/server/modules/analytics/http';

export const GET = withBoot(analyticsSessionHandler);
