/**
 * P8 — single sign-on endpoints: the store's settings (owners and admins, Enterprise) and the two
 * sign-in steps. The sign-in steps have no session yet; the signed flow cookie ties the second to
 * the browser that made the first.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { loadEnv } from '@/server/core/config/env';
import { errors } from '@/server/core/errors/problem';
import { refreshCookie } from '@/server/core/auth/session';
import { recordSessionEvent } from '@/server/core/audit/audit';
import { LIMITS, rateLimiter } from '@/server/core/ratelimit/limiter';
import { clearFlowCookie, completeSsoSignIn, flowCookie, readFlowCookie, saveSsoSettings, ssoSettings, startSsoSignIn } from './service';

const keys = () => { const env = loadEnv(); return { current: env.ENCRYPTION_KEY, previous: env.ENCRYPTION_KEY_PREVIOUS }; };
const clientIp = (request: Request) => request.headers.get('cf-connecting-ip');

async function limited(request: Request): Promise<void> {
  const limit = await rateLimiter().hit(`sso:ip:${clientIp(request) ?? 'unknown'}`, LIMITS.login.limit, LIMITS.login.windowSeconds);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);
}

/** API-082 — GET /api/settings/sso: the store's single sign-on, without its secret. */
export const ssoSettingsHandler = route(async (request) => {
  const config = apiConfig();
  const ctx = await tenantContextFor(request, config);
  return json(await ssoSettings(ctx, config.appUrl));
});

/** API-083 — PUT /api/settings/sso { issuer, clientId, clientSecret?, emailDomains, enabled } (Enterprise). */
export const saveSsoSettingsHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const input = await readJson(request, z.object({
    issuer: z.string().max(500), clientId: z.string().max(300), clientSecret: z.string().max(1000).nullable(),
    emailDomains: z.array(z.string().max(253)).max(20), enabled: z.boolean(),
  }));
  return json(await saveSsoSettings(ctx, input, { appUrl: config.appUrl, keys: keys() }));
});

/** API-018 — POST /api/auth/sso/start { store } → { authorizeUrl }, and the flow cookie for this browser. */
export const startSsoHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  await limited(request);
  const { store } = await readJson(request, z.object({ store: z.string().trim().min(1).max(120) }));
  const { authorizeUrl, flow } = await startSsoSignIn(store, config);
  return json({ authorizeUrl }, { headers: { 'set-cookie': flowCookie(flow, config.secureCookies) } });
});

/** API-019 — POST /api/auth/sso/complete { code, state }: a session locked to the store, like a sign-in's answer. */
export const completeSsoHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  await limited(request);
  const { code, state } = await readJson(request, z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(200) }));
  const issued = await completeSsoSignIn({
    code, state, flowCookie: readFlowCookie(request.headers.get('cookie')),
    userAgent: request.headers.get('user-agent'), ip: clientIp(request),
  }, { ...config, keys: keys() });
  await recordSessionEvent({ action: 'login', tenantId: issued.session.tenantId, userId: issued.session.userId, sessionId: issued.session.id });
  const headers = new Headers();
  headers.append('set-cookie', refreshCookie(issued.refreshToken, config, config.secureCookies));
  headers.append('set-cookie', clearFlowCookie(config.secureCookies)); // the flow is spent
  return json({ accessToken: issued.accessToken, expiresIn: issued.expiresInSeconds, storeId: issued.session.tenantId }, { headers });
});
