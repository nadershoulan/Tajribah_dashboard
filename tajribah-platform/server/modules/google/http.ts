/**
 * T69 — the Google sign-in endpoints that pick a GA4 measurement id (`ga4.ts`). `for: 'site'` is
 * staff choosing the website's id; `for: 'store'` is a store choosing its own (`settings:write`).
 */
import { z } from 'zod';
import { loadEnv } from '@/server/core/config/env';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, authenticate, json, readJson, tenantContextFor, type ApiConfig } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { staffContextFor } from '@/server/modules/admin/access';
import { completeGoogleCallback, GOOGLE_STATE_COOKIE, openTicket, startGoogle, STATE_TTL_MS, type Ga4Purpose, type GoogleApp } from './ga4';

/** The Google OAuth client's settings, or null until one is made in Google Cloud (then ids are pasted). */
export function googleApp(config: Pick<ApiConfig, 'authSecret' | 'appUrl'>): GoogleApp | null {
  const env = loadEnv();
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: new URL('/api/google/callback', config.appUrl).toString(), authSecret: config.authSecret }
    : null;
}
const googleNotYet = () => errors.notImplemented('signing in with Google needs the Google OAuth client set up — paste the measurement id instead');

const stateCookie = (nonce: string, secure: boolean) =>
  `${GOOGLE_STATE_COOKIE}=${nonce}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
const clearStateCookie = (secure: boolean) => `${GOOGLE_STATE_COOKIE}=; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
const cookieValue = (request: Request, name: string) =>
  (request.headers.get('cookie') ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || null;

const FOR = z.object({ for: z.enum(['site', 'store']) });

/** The caller, as the purpose they may start or open: staff for the website, a settings editor for their store. */
async function purposeOf(request: Request, config: ApiConfig, kind: 'site' | 'store'): Promise<Ga4Purpose> {
  if (kind === 'site') return { p: 'site', u: (await staffContextFor(request, config)).userId };
  const ctx = await tenantContextFor(request, config);
  ctx.require('settings:write');
  return { p: 'store', t: ctx.tenantId, u: ctx.actor.userId };
}

/** API-179 — GET /api/google/ga4 → { available }: whether "Sign in with Google" can be offered here. */
export const googleAvailableHandler = route(async (request) => {
  const config = apiConfig();
  await authenticate(request, config);
  return json({ available: googleApp(config) !== null });
});

/** API-180 — POST /api/google/ga4/start { for } → { authorizeUrl }: Google's consent screen, read-only Analytics. */
export const startGoogleHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const { for: kind } = await readJson(request, FOR);
  const purpose = await purposeOf(request, config, kind);
  const app = googleApp(config);
  if (!app) throw googleNotYet();
  const { authorizeUrl, nonce } = await startGoogle(app, purpose);
  return json({ authorizeUrl }, { headers: { 'set-cookie': stateCookie(nonce, config.secureCookies) } });
});

/** API-181 — GET /api/google/callback?code&state: exchanged at once, the streams read, back to the screen that started it. */
export const googleCallbackHandler = route(async (request) => {
  const config = apiConfig();
  const app = googleApp(config);
  if (!app) throw googleNotYet();
  const next = await completeGoogleCallback(new URL(request.url).searchParams, cookieValue(request, GOOGLE_STATE_COOKIE), app);
  return new Response(null, { status: 302, headers: { location: new URL(next, config.appUrl).toString(), 'set-cookie': clearStateCookie(config.secureCookies), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
});

/** API-182 — POST /api/google/ga4/streams { for, ticket } → { streams }: the GA4 web streams that sign-in found. */
export const googleStreamsHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const { for: kind, ticket } = await readJson(request, FOR.extend({ ticket: z.string().min(1).max(16_000) }));
  const purpose = await purposeOf(request, config, kind);
  const app = googleApp(config);
  if (!app) throw googleNotYet();
  return json({ streams: await openTicket(app, ticket, purpose) });
});
