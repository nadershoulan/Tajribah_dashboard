/**
 * P1.25 — store settings endpoints.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { getSettings, updateSettings } from './service';

/** API-080 — GET /api/settings */
export const getSettingsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await getSettings(ctx));
});

/** API-081 — PATCH /api/settings */
export const updateSettingsHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  return json(await updateSettings(ctx, await readJson(request, z.unknown())));
});
