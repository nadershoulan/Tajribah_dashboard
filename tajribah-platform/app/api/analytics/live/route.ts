// API-123 — GET /api/analytics/live (P4.9: what is happening in the shop now)
import { withBoot } from '@/server/boot';
import { analyticsLiveHandler } from '@/server/modules/analytics/http';

export const GET = withBoot(analyticsLiveHandler);
