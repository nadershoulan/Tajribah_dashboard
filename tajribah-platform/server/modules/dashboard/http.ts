/**
 * P1.22 — the home screen's summary.
 */
import { route } from '@/server/core/observability/request';
import { json, tenantContextFor } from '@/server/core/http/api';
import { dashboardSummary } from './service';

/** API-090 — GET /api/dashboard */
export const dashboardHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await dashboardSummary(ctx));
});
