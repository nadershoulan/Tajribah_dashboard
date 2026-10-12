// T140.3 — GET /api/analytics/report/preview: last week's summary, as the email says it
import { withBoot } from '@/server/boot';
import { analyticsReportPreviewHandler } from '@/server/modules/analytics/http';

export const GET = withBoot(analyticsReportPreviewHandler);
