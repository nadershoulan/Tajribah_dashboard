/**
 * T62 — the agency overview's endpoint. The stores are the caller's own memberships (a single sign-on
 * session: its own store only); a staff view of someone else's store adds nothing here.
 */
import { route } from '@/server/core/observability/request';
import { authenticate, json } from '@/server/core/http/api';
import { actorOf } from '@/server/core/auth/session';
import { currentScope } from '@/server/core/observability/scope';
import { storesOverview } from './service';

/** API-088 — GET /api/agency/stores: every store this person can open, and what needs attention. */
export const storesOverviewHandler = route(async (request) => {
  const caller = await authenticate(request);
  const actor = await actorOf(caller.userId);
  const stores = await storesOverview(
    { userId: actor.userId, email: actor.email, isStaff: actor.isStaff },
    { requestId: currentScope()?.requestId ?? 'agency', onlyTenantId: caller.ssoTenantId },
  );
  return json({ stores });
});
