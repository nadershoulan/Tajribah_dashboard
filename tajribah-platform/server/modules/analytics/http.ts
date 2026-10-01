/**
 * P4.4 — analytics read endpoints (read side of P4). The collector and rollup writers are
 * P4.2/P4.3 and live in other files.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { analyticsCsv, analyticsView } from './metrics';
import { reportSubscription, setReportSubscription } from './report';

const RANGE = z.enum(['7d', '30d', '90d']);

/** API-120 — GET /api/analytics?range=7d|30d|90d (MD-120). */
export const analyticsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  const range = RANGE.safeParse(new URL(request.url).searchParams.get('range'));
  return json(await analyticsView(ctx, range.success ? range.data : '30d'));
});

/** API-121 — GET /api/analytics/export?range=: the daily figures as a CSV file (P4.8). */
export const analyticsExportHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  const parsed = RANGE.safeParse(new URL(request.url).searchParams.get('range'));
  const range = parsed.success ? parsed.data : '30d';
  return new Response(await analyticsCsv(ctx, range), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="tajribah-analytics-${range}.csv"`,
      'cache-control': 'no-store',
    },
  });
});

/** API-092 — GET /api/analytics/report: the signed-in member's own weekly summary by email (P4.8). */
export const analyticsReportHandler = route(async (request) => {
  return json(await reportSubscription(await tenantContextFor(request, apiConfig())));
});

/** API-092 — PUT /api/analytics/report { weekly }: turn one's own on or off. */
export const setAnalyticsReportHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const { weekly } = await readJson(request, z.object({ weekly: z.boolean() }));
  return json(await setReportSubscription(ctx, weekly));
});
