/**
 * T62 — an Enterprise store's own address: see it, set or change it, stop using it, and check its DNS
 * records now. Owners and admins change it (`settings:write`); the store's own session, never another's.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { checkCustomDomain, customDomain, removeCustomDomain, setCustomDomain } from './service';

/** API-089 — GET /api/settings/domain: the address and its two records, or null. */
export const customDomainHandler = route(async (request) => {
  const ctx = await tenantContextFor(request, apiConfig());
  return json({ domain: await customDomain(ctx) });
});

/** API-089 — PUT /api/settings/domain { hostname } (Enterprise). */
export const setCustomDomainHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const { hostname } = await readJson(request, z.object({ hostname: z.string().min(1).max(300) }));
  return json({ domain: await setCustomDomain(ctx, hostname) });
});

/** API-089 — DELETE /api/settings/domain. */
export const removeCustomDomainHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  await removeCustomDomain(await tenantContextFor(request, config));
  return new Response(null, { status: 204 });
});

/** API-091 — POST /api/settings/domain/check: look the records up now. */
export const checkCustomDomainHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  return json({ domain: await checkCustomDomain(await tenantContextFor(request, config)) });
});
