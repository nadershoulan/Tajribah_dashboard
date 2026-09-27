// API-121 — GET /api/analytics/export?range=
import { withBoot } from '@/server/boot';
import { analyticsExportHandler } from '@/server/modules/analytics/http';

export const GET = withBoot(analyticsExportHandler);
