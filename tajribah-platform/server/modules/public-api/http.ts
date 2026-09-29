/**
 * P8 — the Public API, v1: read endpoints for a store's own integrations, authenticated by an API
 * key only (`Authorization: Bearer tjr_…` — a dashboard session is not accepted here), limited per
 * key, answering the v1 shapes and nothing else. Errors are problem documents, as everywhere.
 */
import { z } from 'zod';
import { ProductListQuery } from '@/lib/contracts/products';
import { V1_RATE, openApiDocument } from '@/lib/public-api/v1';
import { loadEnv } from '@/server/core/config/env';
import { errors } from '@/server/core/errors/problem';
import { apiConfig, json } from '@/server/core/http/api';
import { route } from '@/server/core/observability/request';
import { rateLimiter } from '@/server/core/ratelimit/limiter';
import type { TenantContext } from '@/server/core/tenancy/context';
import { analyticsView } from '@/server/modules/analytics/metrics';
import { apiKeyContextFor } from '@/server/modules/api-keys/auth';
import { listModels } from '@/server/modules/models/library';
import { getProduct, listProducts } from '@/server/modules/products/service';
import { analyticsV1, modelV1, productV1 } from './v1';

/** Authenticate the key, then count the request against it; the answer carries what is left. */
function v1(handler: (ctx: TenantContext, request: Request) => Promise<unknown>) {
  return route(async (request) => {
    const ctx = await apiKeyContextFor(request, { authSecret: apiConfig().authSecret });
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')![1]!;
    const limit = await rateLimiter().hit(`public-api:${token.slice(0, 12)}`, V1_RATE.limit, V1_RATE.windowSeconds);
    if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);
    const response = json(await handler(ctx, request));
    response.headers.set('x-ratelimit-limit', String(V1_RATE.limit));
    response.headers.set('x-ratelimit-remaining', String(limit.remaining));
    return response;
  });
}

const RANGE = z.enum(['7d', '30d', '90d']).catch('30d');

/** API-V01 — GET /api/v1/products?limit=&cursor= */
export const v1ListProductsHandler = v1(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const query = ProductListQuery.safeParse({ limit: params.get('limit') ?? undefined, cursor: params.get('cursor') ?? undefined });
  if (!query.success) throw errors.validation({ query: ['limit is 1 to 200; cursor is a nextCursor from a previous page'] });
  const page = await listProducts(ctx, query.data);
  return { data: page.rows.map(productV1), nextCursor: page.nextCursor };
});

/** API-V02 — GET /api/v1/products/[id] */
export const v1ProductHandler = v1(async (ctx, request) => {
  const id = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('product');
  return productV1(await getProduct(ctx, id));
});

/** API-V03 — GET /api/v1/models */
export const v1ModelsHandler = v1(async (ctx) => ({ data: (await listModels(ctx)).map(modelV1) }));

/** API-V04 — GET /api/v1/analytics?range=7d|30d|90d */
export const v1AnalyticsHandler = v1(async (ctx, request) =>
  analyticsV1(await analyticsView(ctx, RANGE.parse(new URL(request.url).searchParams.get('range') ?? '30d'))));

/** API-V00 — GET /api/v1/openapi.json: the reference, public (no key). */
export const v1OpenApiHandler = route(async () =>
  Response.json(openApiDocument(loadEnv().APP_URL), { headers: { 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } }));
