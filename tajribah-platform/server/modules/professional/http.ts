/**
 * P3.10 — professional 3D model endpoints (the merchant's side).
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { acceptQuote, cancelOrder, listOrders, requestOrder } from './service';

/** API-135 — GET /api/professional: the store's orders. */
export const listProfessionalHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ orders: await listOrders(ctx) });
});

/** API-136 — POST /api/professional { productId, note }: ask for a professional model. */
export const requestProfessionalHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  return json(await requestOrder(ctx, await readJson(request, z.unknown())), { status: 201 });
});

/** API-137 — DELETE /api/professional/[id]: cancel before work starts. */
export const cancelProfessionalHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const id = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('order');
  return json(await cancelOrder(ctx, id));
});

/** API-139 — POST /api/professional/[id]/accept: accept the quote (T68: payment by bank transfer follows). */
export const acceptProfessionalHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('order');
  return json(await acceptQuote(ctx, id));
});
