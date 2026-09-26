/**
 * A1 — admin console endpoints. Every one starts with `staffContextFor`: staff with two-step
 * sign-in, or 404/403. Reads here are not staff actions; changes (A4 onward) are logged.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { json } from '@/server/core/http/api';
import { staffContextFor, staffTrail } from './access';
import { platformOverview } from './overview';

/** API-A00 — GET /api/admin/whoami: the console's own guard asks this first. */
export const whoamiHandler = route(async (request) => {
  const staff = await staffContextFor(request);
  return json({ email: staff.email, fullName: staff.fullName });
});

/** API-A01 — GET /api/admin/audit?store=: the staff trail, newest first. */
export const staffTrailHandler = route(async (request) => {
  await staffContextFor(request);
  const store = new URL(request.url).searchParams.get('store');
  const storeId = store && z.string().uuid().safeParse(store).success ? store : undefined;
  return json({ entries: await staffTrail({ storeId }) });
});

/** API-A02 — GET /api/admin/overview: the platform at a glance (A2, ADM-02). */
export const overviewHandler = route(async (request) => {
  await staffContextFor(request);
  return json(await platformOverview());
});
