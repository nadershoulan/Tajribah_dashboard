/**
 * P1.11 — store connection endpoints. The shapes carry no token field at all
 * (`ConnectionSummary` is built field by field in the service), so nothing here can leak one.
 */
import { z } from 'zod';
import type { ConnectionDetail } from '@/lib/view-models';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { latestSync, requestSync } from '@/server/modules/sync/service';
import { webhookHealth } from '@/server/modules/webhooks/service';
import { disconnectStore, listConnections } from './service';

/** The `[id]` segment at `index` from the end. A malformed id is a 404, like a missing one. */
function idFrom(request: Request, fromEnd: number): string {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1 - fromEnd] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('store connection');
  return id;
}

export async function connectionDetails(ctx: TenantContext): Promise<ConnectionDetail[]> {
  const connections = await listConnections(ctx);
  return Promise.all(connections.map(async (c) => ({
    ...c,
    latestSync: await latestSync(ctx, c.id),
    webhooks: await webhookHealth(ctx, c.id),
  })));
}

/** API-060 — GET /api/connections */
export const listConnectionsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ connections: await connectionDetails(ctx) });
});

/** API-061 — POST /api/connections/[id]/sync → the sync, queued (or the one already running) */
export const requestSyncHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  // Another store's id is a 404 from the row lock inside `requestSync`.
  return json(await requestSync(ctx, idFrom(request, 1), { type: 'incremental', triggeredBy: 'user' }), { status: 202 });
});

/** API-062 — DELETE /api/connections/[id] → tokens forgotten, products kept */
export const disconnectHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  await disconnectStore(ctx, idFrom(request, 0));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});
