/**
 * P1.21 — AR settings endpoints.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { listArConfigs, saveArConfig } from './service';
import { publishProduct, unpublishProduct } from '@/server/modules/edge/publish';
import { saveHostedPage } from '@/server/modules/hosted-pages/service';

/** API-100 — GET /api/ar-configs */
export const listArConfigsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ configs: await listArConfigs(ctx) });
});

/** API-101 — PUT /api/ar-configs/[productId] */
export const saveArConfigHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const id = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('product');
  return json(await saveArConfig(ctx, id, await readJson(request, z.unknown())));
});

/** API-102 — POST /api/ar-configs/[productId]/publish (P1.15) */
export const publishArConfigHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('product');
  return json(await publishProduct(ctx, id));
});

/** API-103 — DELETE /api/ar-configs/[productId]/publish (T40): take the product off the shop. */
export const unpublishArConfigHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('product');
  return json(await unpublishProduct(ctx, id));
});

/** API-126 — PUT /api/ar-configs/[productId]/page (P1.19): the product's own page — on or off, and the buy link. */
export const saveHostedPageHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('product');
  return json(await saveHostedPage(ctx, id, await readJson(request, z.unknown())));
});
