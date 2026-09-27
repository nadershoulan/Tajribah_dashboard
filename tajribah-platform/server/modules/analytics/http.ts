/**
 * P4.4 — analytics read endpoints (read side of P4). The collector and rollup writers are
 * P4.2/P4.3 and live in other files.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { json, tenantContextFor } from '@/server/core/http/api';
import { analyticsView } from './metrics';

const RANGE = z.enum(['7d', '30d', '90d']);

/** API-120 — GET /api/analytics?range=7d|30d|90d (MD-120). */
export const analyticsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  const range = RANGE.safeParse(new URL(request.url).searchParams.get('range'));
  return json(await analyticsView(ctx, range.success ? range.data : '30d'));
});
