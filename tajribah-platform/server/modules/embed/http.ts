/**
 * P1.17 — the install snippet and the install checker.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { checkInstall, snippetFor } from './service';

/** API-120 — GET /api/embed */
export const snippetHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await snippetFor(ctx));
});

/** API-121 — POST /api/embed/check { url } */
export const checkInstallHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const { url } = await readJson(request, z.object({ url: z.string().max(2048) }));
  return json(await checkInstall(ctx, url));
});
