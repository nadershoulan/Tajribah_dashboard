/**
 * P4 — the analytics endpoints: the dashboard's reads (P4.4, P4.8) and the collector's one public
 * door (P4.2, `ingest.ts`).
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { analyticsCsv, analyticsView } from './metrics';
import { reportSubscription, setReportSubscription } from './report';
import { collectResponse, collectThenAnswer } from './ingest';
import { liveActivity } from './live';
import { SESSION_FILTERS, sessionList, sessionPath } from './sessions';

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

/** API-123 — GET /api/analytics/live: the last half hour, from the raw events (P4.9). */
export const analyticsLiveHandler = route(async (request) => {
  return json(await liveActivity(await tenantContextFor(request, apiConfig())));
});

/** API-124 — GET /api/analytics/sessions?day=&filter=&offset=&limit=: the visits of one Riyadh day (P4.10). */
export const analyticsSessionsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request, apiConfig());
  const query = new URL(request.url).searchParams;
  const filter = z.enum(SESSION_FILTERS).safeParse(query.get('filter'));
  const offset = Number(query.get('offset') ?? 0);
  const limit = Number(query.get('limit') ?? 50); // T76: 10, 25, 50 or 100
  return json(await sessionList(ctx, { day: query.get('day'), filter: filter.success ? filter.data : 'all', offset: Number.isFinite(offset) ? offset : 0, limit }));
});

/** API-125 — GET /api/analytics/sessions/[id]: one visit's events in order. */
export const analyticsSessionHandler = route(async (request) => {
  const ctx = await tenantContextFor(request, apiConfig());
  const id = decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '');
  return json(await sessionPath(ctx, id));
});

/**
 * API-122 — POST /api/analytics/collect (and `/v1/e`, the widget's address): one batch of a shop's
 * events. No session, no same-origin check, no CORS: the page sends a beacon and reads nothing back.
 */
export const collectHandler = route(async (request) => {
  return collectResponse(await collectThenAnswer(request, { secret: apiConfig().authSecret }));
});
