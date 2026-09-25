/**
 * P1.23 — the caller's own notifications.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { markRead, myNotifications } from './service';

/** API-110 — GET /api/notifications */
export const listNotificationsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await myNotifications(ctx));
});

/** API-111 — POST /api/notifications/read { ids: string[] } | { all: true } */
export const markReadHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.union([
    z.object({ ids: z.array(z.string().uuid()).max(100) }),
    z.object({ all: z.literal(true) }),
  ]));
  return json({ marked: await markRead(ctx, 'all' in body ? 'all' : body.ids) });
});
