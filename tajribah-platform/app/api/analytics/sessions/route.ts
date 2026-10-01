// API-124 — GET /api/analytics/sessions (P4.10: the visits of one day)
import { withBoot } from '@/server/boot';
import { analyticsSessionsHandler } from '@/server/modules/analytics/http';

export const GET = withBoot(analyticsSessionsHandler);
