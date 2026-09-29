// API-V04 — GET /api/v1/analytics (P8, Public API)
import { withBoot } from '@/server/boot';
import { v1AnalyticsHandler } from '@/server/modules/public-api/http';

export const GET = withBoot(v1AnalyticsHandler);
