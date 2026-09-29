/**
 * P8 — API key endpoints for the store's dashboard (a person signed in; never a key making keys).
 */
import { z } from 'zod';
import { errors } from '@/server/core/errors/problem';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { route } from '@/server/core/observability/request';
import { createApiKey, listApiKeys, revokeApiKey } from './service';

/** API-160 — GET /api/api-keys */
export const listApiKeysHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ keys: await listApiKeys(ctx) });
});

/** API-161 — POST /api/api-keys { name, scopes, expiresInDays } → { key, apiKey } (the key, this once) */
export const createApiKeyHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.object({
    name: z.string().max(200), scopes: z.array(z.string().max(40)).max(40), expiresInDays: z.number().int().nullable(),
  }));
  const made = await createApiKey(ctx, body, { authSecret: config.authSecret });
  return json(made, { status: 201 }); // no-store, like every json answer
});

/** API-162 — POST /api/api-keys/[id]/revoke */
export const revokeApiKeyHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 2] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('api_key');
  return json(await revokeApiKey(ctx, id));
});
