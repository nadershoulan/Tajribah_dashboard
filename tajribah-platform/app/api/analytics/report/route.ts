// API-092 — GET · PUT /api/analytics/report (P4.8: the member's own weekly summary by email)
import { withBoot } from '@/server/boot';
import { analyticsReportHandler, setAnalyticsReportHandler } from '@/server/modules/analytics/http';

export const GET = withBoot(analyticsReportHandler);
export const PUT = withBoot(setAnalyticsReportHandler);
