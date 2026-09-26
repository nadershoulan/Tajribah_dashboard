/**
 * P0.19 — the auth endpoints, as plain `(Request) => Response` handlers.
 *
 * The `app/api/auth/**` route files are one-line adapters around these, so every endpoint is
 * tested here, in Node, exactly as the Worker will run it. Every handler goes through
 * `route()` (request id, access log, problem+json on error).
 *
 * Tokens: the access token is returned in the body and held in client memory; the refresh
 * token is only ever the httpOnly cookie (`refreshCookie`), never in a body.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, authenticate, json, readJson } from '@/server/core/http/api';
import {
  actorOf, clearRefreshCookie, readRefreshCookie, refreshCookie, revokeByRefreshToken,
  rotateSession, setSessionTenant, type IssuedSession,
} from '@/server/core/auth/session';
import { buildTenantContext, membershipsOf } from '@/server/core/tenancy/context';
import { planCodesFor, readOnlyFor } from '@/server/core/billing/entitlements';
import { errors, problemResponse } from '@/server/core/errors/problem';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import { recordSessionEvent } from '@/server/core/audit/audit';
import { log } from '@/server/core/observability/log';
import { currentScope } from '@/server/core/observability/scope';
import { login, register, requestPasswordReset, resendEmailVerification, resetPassword, verifyEmail } from './service';
import {
  completeTwoFactorLogin, disableTwoFactor, enableTwoFactor, regenerateBackupCodes, startTwoFactorSetup, twoFactorStatus,
} from './two-factor';

const PASSWORD = z.string().min(10, 'at least 10 characters').max(200);
const EMAIL_FIELD = z.string().trim().email().max(254);

const clientIp = (request: Request) => request.headers.get('cf-connecting-ip');
const userAgent = (request: Request) => request.headers.get('user-agent');

/** The body every sign-in style endpoint returns. The refresh token is not in it. */
function sessionResponse(issued: IssuedSession, extra: Record<string, unknown> = {}, status = 200): Response {
  const config = apiConfig();
  return json(
    { accessToken: issued.accessToken, expiresIn: issued.expiresInSeconds, ...extra },
    { status, headers: { 'set-cookie': refreshCookie(issued.refreshToken, config, config.secureCookies) } },
  );
}

// ---------------------------------------------------------------------- endpoints

/** API-001 — POST /api/auth/register */
export const registerHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const body = await readJson(request, z.object({
    email: EMAIL_FIELD,
    password: PASSWORD,
    fullName: z.string().trim().min(1).max(120),
    storeName: z.string().trim().min(1).max(120),
    locale: z.enum(['ar', 'en']).default('ar'),
    phone: z.string().max(32).optional(),
  }));

  const result = await register({ ...body, userAgent: userAgent(request), ip: clientIp(request) }, config);
  await sendEmail(result.user.email, EMAIL.verifyEmail, {
    link: `${config.appUrl}/verify-email?token=${encodeURIComponent(result.emailVerificationToken)}`,
  }, body.locale);

  return sessionResponse(result.session, {
    user: { id: result.user.id, email: result.user.email, fullName: result.user.fullName },
    tenant: { id: result.tenant.id, slug: result.tenant.slug, name: result.tenant.name },
    slugNeedsConfirmation: result.slugNeedsConfirmation,
  }, 201);
});

/** API-002 — POST /api/auth/login */
export const loginHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const body = await readJson(request, z.object({ email: EMAIL_FIELD, password: z.string().min(1).max(200) }));
  const issued = await login({ ...body, userAgent: userAgent(request), ip: clientIp(request) }, config);
  // P1.2b: the password was right but a code is still needed — no session, no cookie yet.
  if ('twoFactorChallenge' in issued) return json({ twoFactorRequired: true, challenge: issued.twoFactorChallenge });
  await recordSessionEvent({ action: 'login', tenantId: issued.session.tenantId, userId: issued.session.userId, sessionId: issued.session.id });
  return sessionResponse(issued);
});

/** API-011 — POST /api/auth/login/2fa: the second sign-in step (AUTH-12 code, AUTH-14 backup code). */
export const loginTwoFactorHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const body = await readJson(request, z.object({ challenge: z.string().min(10).max(300), code: z.string().trim().min(1).max(20) }));
  const issued = await completeTwoFactorLogin({ ...body, userAgent: userAgent(request), ip: clientIp(request) }, config);
  await recordSessionEvent({ action: 'login', tenantId: issued.session.tenantId, userId: issued.session.userId, sessionId: issued.session.id });
  return sessionResponse(issued);
});

/** API-003 — POST /api/auth/refresh. Reads only the cookie; a failure clears it. */
export const refreshHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const token = readRefreshCookie(request.headers.get('cookie'));
  const result = token
    ? await rotateSession({ refreshToken: token, config, userAgent: userAgent(request), ip: clientIp(request) })
    : { ok: false as const, reason: 'unknown' as const };

  if (!result.ok) {
    log.info('refresh refused', { reason: result.reason });
    const response = problemResponse(errors.unauthenticated(), { requestId: currentScope()?.requestId, instance: '/api/auth/refresh' });
    response.headers.set('set-cookie', clearRefreshCookie(config.secureCookies));
    return response;
  }
  return sessionResponse(result.issued);
});

/** API-004 — POST /api/auth/logout. Always 204: the goal state is "signed out", whatever the start. */
export const logoutHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const token = readRefreshCookie(request.headers.get('cookie'));
  const ended = token ? await revokeByRefreshToken(token, config) : null;
  if (ended) await recordSessionEvent({ action: 'logout', tenantId: ended.tenantId, userId: ended.userId, sessionId: ended.id });
  return new Response(null, { status: 204, headers: { 'set-cookie': clearRefreshCookie(config.secureCookies), 'cache-control': 'no-store' } });
});

/** API-005 — GET /api/auth/me: who is signed in, and which stores they can switch between. */
export const meHandler = route(async (request) => {
  const caller = await authenticate(request);
  const actor = await actorOf(caller.userId);
  const stores = await membershipsOf(caller.userId);
  const plans = await planCodesFor(stores.map(({ tenant }) => tenant.id));
  const readOnly = await readOnlyFor(stores.map(({ tenant }) => tenant));
  return json({
    user: { id: actor.userId, email: actor.email, fullName: actor.fullName, emailVerified: actor.emailVerified, locale: actor.locale, isStaff: actor.isStaff },
    currentTenantId: caller.tenantId,
    tenants: stores.map(({ tenant, role }) => ({
      id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, role,
      plan: plans.get(tenant.id) ?? 'starter',
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      logoUrl: tenant.logoUrl ?? null,
      readOnly: readOnly.get(tenant.id) ?? null,
    })),
  });
});

/** API-006 — POST /api/auth/switch-tenant. A store the caller is not a member of is a 404. */
export const switchTenantHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const caller = await authenticate(request, config);
  const { tenantId } = await readJson(request, z.object({ tenantId: z.string().uuid() }));
  const actor = await actorOf(caller.userId);
  await buildTenantContext({  // throws not_found unless an active membership exists
    actor: { userId: actor.userId, email: actor.email, isStaff: actor.isStaff },
    tenantId, requestId: currentScope()?.requestId ?? 'unscoped',
  });
  const accessToken = await setSessionTenant(caller.sessionId, tenantId, config);
  return json({ accessToken, expiresIn: config.accessTtlMinutes * 60, tenantId });
});

/** API-007 — POST /api/auth/verify-email */
export const verifyEmailHandler = route(async (request) => {
  const config = apiConfig();
  const { token } = await readJson(request, z.object({ token: z.string().min(10).max(200) }));
  if (!(await verifyEmail(token, config))) throw errors.validation({ token: ['invalid or expired'] });
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});

/** API-010 — POST /api/auth/verify-email/resend: a new link to the signed-in user's own address. */
export const resendVerificationHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const caller = await authenticate(request, config);
  const resent = await resendEmailVerification(caller.userId, config);
  if (resent) {
    await sendEmail(resent.email, EMAIL.verifyEmail, {
      link: `${config.appUrl}/verify-email?token=${encodeURIComponent(resent.token)}`,
    }, resent.locale);
  }
  return json({ sent: resent !== null, alreadyVerified: resent === null }, { status: 202 });
});

// ------------------------------------------------------------ two-step sign-in (P1.2b)

const PASSWORD_AGAIN = z.object({ password: z.string().min(1).max(200) });

/** API-012 — GET /api/auth/2fa: is it on, and how many backup codes are left. */
export const twoFactorStatusHandler = route(async (request) => {
  const caller = await authenticate(request);
  return json(await twoFactorStatus(caller.userId));
});

/** API-013 — POST /api/auth/2fa/setup: a new secret to scan. Needs the password. */
export const twoFactorSetupHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const caller = await authenticate(request, config);
  const { password } = await readJson(request, PASSWORD_AGAIN);
  return json(await startTwoFactorSetup(caller.userId, password));
});

/** API-014 — POST /api/auth/2fa/enable: the first code; the backup codes come back once. */
export const twoFactorEnableHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const caller = await authenticate(request, config);
  const { code } = await readJson(request, z.object({ code: z.string().trim().min(1).max(20) }));
  return json(await enableTwoFactor(caller.userId, code, config.authSecret));
});

/** API-015 — POST /api/auth/2fa/disable: the password and a code (or a backup code). */
export const twoFactorDisableHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const caller = await authenticate(request, config);
  const body = await readJson(request, PASSWORD_AGAIN.extend({ code: z.string().trim().min(1).max(20) }));
  await disableTwoFactor(caller.userId, body, config.authSecret);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});

/** API-016 — POST /api/auth/2fa/backup-codes: new backup codes; the old ones stop working. */
export const twoFactorBackupCodesHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const caller = await authenticate(request, config);
  const { password } = await readJson(request, PASSWORD_AGAIN);
  return json(await regenerateBackupCodes(caller.userId, password, config.authSecret));
});

/**
 * API-008 — POST /api/auth/password-reset. Always 202, and the same body whether or not the
 * address exists: an unauthenticated caller does not get to learn who has an account.
 */
export const requestResetHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const { email, locale } = await readJson(request, z.object({ email: EMAIL_FIELD, locale: z.enum(['ar', 'en']).default('ar') }));
  const token = await requestPasswordReset(email, config, clientIp(request));
  if (token) {
    await sendEmail(email, EMAIL.passwordReset, {
      link: `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`, minutes: 60,
    }, locale);
  }
  return json({ accepted: true }, { status: 202 });
});

/** API-009 — POST /api/auth/password-reset/confirm. Ends every session on success. */
export const confirmResetHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const body = await readJson(request, z.object({ token: z.string().min(10).max(200), password: PASSWORD }));
  if (!(await resetPassword({ ...body, config }))) throw errors.validation({ token: ['invalid or expired'] });
  return new Response(null, { status: 204, headers: { 'set-cookie': clearRefreshCookie(config.secureCookies), 'cache-control': 'no-store' } });
});
