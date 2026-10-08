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
import {
  completeGoogleCallback, completeProvisioning, GOOGLE_PENDING_COOKIE, GOOGLE_STATE_COOKIE, openTicket, PENDING_TTL_MS, startGoogle, STATE_TTL_MS,
  type CallbackResult, type Ga4Purpose, type GoogleApp, type NewAccount,
} from './ga4';

/** The Google OAuth client's settings, or null until one is made in Google Cloud (then ids are pasted). */
export function googleApp(config: Pick<ApiConfig, 'authSecret' | 'appUrl'>): GoogleApp | null {
  const env = loadEnv();
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: new URL('/api/google/callback', config.appUrl).toString(), authSecret: config.authSecret,
      provisionedUri: new URL('/api/google/provisioned', config.appUrl).toString() }
    : null;
}
const googleNotYet = () => errors.notImplemented('signing in with Google needs the Google OAuth client set up — paste the measurement id instead');

const stateCookie = (nonce: string, secure: boolean) =>
  `${GOOGLE_STATE_COOKIE}=${nonce}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
const clearStateCookie = (secure: boolean) => `${GOOGLE_STATE_COOKIE}=; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
// T121: the encrypted token across Google's terms page. Lax: Google's page sends the person back with a plain link.
const pendingCookie = (value: string, secure: boolean) =>
  `${GOOGLE_PENDING_COOKIE}=${value}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${PENDING_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
const clearPendingCookie = (secure: boolean) => `${GOOGLE_PENDING_COOKIE}=; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
const cookieValue = (request: Request, name: string) =>
  (request.headers.get('cookie') ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || null;

const FOR = z.object({ for: z.enum(['site', 'store']) });
/** T121: `create` — a new GA4 account even when the person has some (the screen's "create a new one"). */
const START = FOR.extend({ create: z.boolean().optional() });

/** The caller, as the purpose they may start or open: staff for the website, a settings editor for their store. */
async function purposeOf(request: Request, config: ApiConfig, kind: 'site' | 'store'): Promise<Ga4Purpose & { account: NewAccount }> {
  // T121: what a GA4 account made for them would be called, and the address it measures.
  if (kind === 'site') return { p: 'site', u: (await staffContextFor(request, config)).userId, account: { name: 'Tajribah', website: new URL('/', config.appUrl).toString() } };
  const ctx = await tenantContextFor(request, config);
  ctx.require('settings:write');
  // The store's own product pages (the stream's address is a label; it can be changed in Google Analytics).
  const website = new URL(`/p/${ctx.tenant.slug}`, config.appUrl).toString();
  return { p: 'store', t: ctx.tenantId, u: ctx.actor.userId, account: { name: ctx.tenant.name, website } };
}

const justPurpose = ({ account: _a, ...purpose }: Ga4Purpose & { account: NewAccount }): Ga4Purpose => { void _a; return purpose as Ga4Purpose; };

/** The redirect the two Google returns answer with, and the cookies each sets. */
function redirect(result: CallbackResult, config: ApiConfig, nonce: string | null): Response {
  const headers = new Headers({ location: new URL(result.location, config.appUrl).toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  // Back to Google for the permission to create: the browser's nonce carries on; otherwise it is spent.
  headers.append('set-cookie', result.keepState && nonce ? stateCookie(nonce, config.secureCookies) : clearStateCookie(config.secureCookies));
  headers.append('set-cookie', result.pending ? pendingCookie(result.pending, config.secureCookies) : clearPendingCookie(config.secureCookies));
  return new Response(null, { status: 302, headers });
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
  const { for: kind, create } = await readJson(request, START);
  const { account, ...purpose } = await purposeOf(request, config, kind);
  const app = googleApp(config);
  if (!app) throw googleNotYet();
  const { authorizeUrl, nonce } = await startGoogle(app, purpose as Ga4Purpose, Date.now(), { account, create: !!create && !!app.provisionedUri });
  return json({ authorizeUrl }, { headers: { 'set-cookie': stateCookie(nonce, config.secureCookies) } });
});

/** API-181 — GET /api/google/callback?code&state: exchanged at once, the streams read, back to the screen that started it. */
export const googleCallbackHandler = route(async (request) => {
  const config = apiConfig();
  const app = googleApp(config);
  if (!app) throw googleNotYet();
  const nonce = cookieValue(request, GOOGLE_STATE_COOKIE);
  return redirect(await completeGoogleCallback(new URL(request.url).searchParams, nonce, app), config, nonce);
});

/** API-183 (T121) — GET /api/google/provisioned: back from Google's terms page; the new account gets its web stream. */
export const googleProvisionedHandler = route(async (request) => {
  const config = apiConfig();
  const app = googleApp(config);
  if (!app) throw googleNotYet();
  return redirect(await completeProvisioning(cookieValue(request, GOOGLE_PENDING_COOKIE), app), config, null);
});

/** API-182 — POST /api/google/ga4/streams { for, ticket } → { streams }: the GA4 web streams that sign-in found. */
export const googleStreamsHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const { for: kind, ticket } = await readJson(request, FOR.extend({ ticket: z.string().min(1).max(16_000) }));
  const purpose = justPurpose(await purposeOf(request, config, kind));
  const app = googleApp(config);
  if (!app) throw googleNotYet();
  return json({ streams: await openTicket(app, ticket, purpose) });
});
