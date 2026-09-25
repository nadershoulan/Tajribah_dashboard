/**
 * P1.24 — team endpoints, and accepting an invitation.
 */
import { z } from 'zod';
import { MEMBER_ROLE } from '@/lib/permissions';
import { actorOf, setSessionTenant } from '@/server/core/auth/session';
import { errors } from '@/server/core/errors/problem';
import { apiConfig, assertSameOrigin, authenticate, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { loadEnv } from '@/server/core/config/env';
import { route } from '@/server/core/observability/request';
import { acceptInvitation, changeRole, invite, listTeam, removeMember, revokeInvitation } from './service';

function lastId(request: Request, what: string): string {
  const id = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound(what);
  return id;
}

const noContent = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

/** API-070 — GET /api/team */
export const listTeamHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ members: await listTeam(ctx) });
});

/** API-071 — POST /api/team/invitations { email, role } */
export const inviteHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.object({ email: z.string().max(254), role: z.enum(MEMBER_ROLE) }));
  const { id } = await invite(ctx, body, { authSecret: config.authSecret, appUrl: loadEnv().APP_URL });
  return json({ id }, { status: 201 }); // the token only ever travels in the email
});

/** API-072 — DELETE /api/team/invitations/[id] */
export const revokeInvitationHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  await revokeInvitation(ctx, lastId(request, 'invitation'));
  return noContent();
});

/** API-073 — PATCH /api/team/members/[id] { role } */
export const changeRoleHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const { role } = await readJson(request, z.object({ role: z.enum(MEMBER_ROLE) }));
  await changeRole(ctx, lastId(request, 'team member'), role);
  return noContent();
});

/** API-074 — DELETE /api/team/members/[id] */
export const removeMemberHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  await removeMember(ctx, lastId(request, 'team member'));
  return noContent();
});

/** API-075 — POST /api/invitations/accept { token } → the session now acts for the joined store */
export const acceptInvitationHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const caller = await authenticate(request, config);
  const { token } = await readJson(request, z.object({ token: z.string().min(10).max(200) }));
  await actorOf(caller.userId);
  const { tenantId } = await acceptInvitation({ token, userId: caller.userId, authSecret: config.authSecret });
  const accessToken = await setSessionTenant(caller.sessionId, tenantId, config);
  return json({ accessToken, expiresIn: config.accessTtlMinutes * 60, tenantId });
});
