/**
 * P8 — outgoing webhook endpoints, for the store's dashboard (a person signed in).
 */
import { z } from 'zod';
import { errors } from '@/server/core/errors/problem';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { route } from '@/server/core/observability/request';
import { createEndpoint, deleteEndpoint, listDeliveries, listEndpoints, redeliver, rotateSecret, sendTest, updateEndpoint } from './service';

/** The uuid `back` segments from the end of the path (0 = the last). */
function idAt(request: Request, back: number, what: string): string {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1 - back] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound(what);
  return id;
}

async function writer(request: Request) {
  const config = apiConfig();
  assertSameOrigin(request, config);
  return tenantContextFor(request, config);
}

const EVENTS = z.array(z.string().max(60)).max(20);

/** API-170 — GET /api/webhook-endpoints */
export const listEndpointsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ endpoints: await listEndpoints(ctx) });
});

/** API-171 — POST /api/webhook-endpoints { url, events, description? } → { endpoint, secret } (the secret, this once) */
export const createEndpointHandler = route(async (request) => {
  const ctx = await writer(request);
  const body = await readJson(request, z.object({ url: z.string().max(2048), events: EVENTS, description: z.string().max(400).nullable().optional() }));
  return json(await createEndpoint(ctx, body), { status: 201 });
});

/** API-172 — PATCH /api/webhook-endpoints/[id] { url?, events?, description?, active? } */
export const updateEndpointHandler = route(async (request) => {
  const ctx = await writer(request);
  const body = await readJson(request, z.object({
    url: z.string().max(2048).optional(), events: EVENTS.optional(), description: z.string().max(400).nullable().optional(), active: z.boolean().optional(),
  }));
  return json(await updateEndpoint(ctx, idAt(request, 0, 'webhook_endpoint'), body));
});

/** API-173 — DELETE /api/webhook-endpoints/[id] */
export const deleteEndpointHandler = route(async (request) => {
  const ctx = await writer(request);
  await deleteEndpoint(ctx, idAt(request, 0, 'webhook_endpoint'));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});

/** API-174 — POST /api/webhook-endpoints/[id]/rotate → { secret } (this once) */
export const rotateSecretHandler = route(async (request) => {
  const ctx = await writer(request);
  return json(await rotateSecret(ctx, idAt(request, 1, 'webhook_endpoint')));
});

/** API-175 — POST /api/webhook-endpoints/[id]/test → the ping's delivery */
export const sendTestHandler = route(async (request) => {
  const ctx = await writer(request);
  return json(await sendTest(ctx, idAt(request, 1, 'webhook_endpoint')), { status: 202 });
});

/** API-176 — GET /api/webhook-endpoints/[id]/deliveries */
export const listDeliveriesHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ deliveries: await listDeliveries(ctx, idAt(request, 1, 'webhook_endpoint')) });
});

/** API-177 — POST /api/webhook-deliveries/[id]/redeliver */
export const redeliverHandler = route(async (request) => {
  const ctx = await writer(request);
  return json(await redeliver(ctx, idAt(request, 1, 'webhook_delivery')), { status: 202 });
});
