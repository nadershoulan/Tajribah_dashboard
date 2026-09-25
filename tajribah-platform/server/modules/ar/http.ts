/**
 * P1.21 — AR settings endpoints.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { listArConfigs, saveArConfig } from './service';

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
