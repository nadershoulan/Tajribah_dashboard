/**
 * P0.19 — what every API route handler shares: config, body validation, the same-origin
 * check, and "who is calling".
 *
 * Authentication is the access token in `Authorization: Bearer …` (it lives in client
 * memory, never in storage — see session.ts). The token alone is not trusted: the session
 * behind it is loaded on every request, so logout and theft detection take effect at once
 * rather than when the 15-minute token expires.
 */
import type { z } from 'zod';
import { loadEnv } from '../config/env';
import { errors, fieldErrorsFrom } from '../errors/problem';
import { actorOf, readAccessToken, requireSession, type SessionSecrets } from '../auth/session';
import { bindActor, currentScope } from '../observability/scope';
import { buildTenantContext, type TenantContext } from '../tenancy/context';

export type ApiConfig = SessionSecrets & {
  appUrl: string;
  /** Cookies get `Secure` everywhere except plain-http local development. */
  secureCookies: boolean;
};

export function apiConfig(): ApiConfig {
  const env = loadEnv();
  return {
    authSecret: env.AUTH_SECRET,
    accessTtlMinutes: env.SESSION_TTL_MINUTES,
    refreshTtlDays: env.REFRESH_TTL_DAYS,
    appUrl: env.APP_URL,
    secureCookies: env.APP_URL.startsWith('https://'),
  };
}

/** Parse a JSON body against `schema`; a bad body is a 422 with per-field messages. */
export async function readJson<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw errors.validation({ _: ['body must be JSON'] });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw errors.validation(fieldErrorsFrom(parsed.error.issues));
  return parsed.data;
}

/**
 * Refuse a state-changing request from another site. The refresh cookie is SameSite=Lax,
 * which already stops most cross-site POSTs; this closes the rest (old browsers, and a
 * same-site-but-other-subdomain page). Fetch metadata first, the Origin header as fallback.
 */
export function assertSameOrigin(request: Request, config: ApiConfig): void {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') return;
  const origin = request.headers.get('origin');
  if (origin && origin === new URL(config.appUrl).origin) return;
  if (!site && !origin) return; // not a browser (curl, server-to-server): no ambient cookie to abuse
  throw errors.forbidden('cross-origin request refused');
}

export type Caller = { userId: string; sessionId: string; tenantId: string | null };

/** The authenticated caller, or 401. Binds the user (and tenant) to every later log line. */
export async function authenticate(request: Request, config: ApiConfig = apiConfig()): Promise<Caller> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw errors.unauthenticated();
  const claims = await readAccessToken(match[1], config.authSecret);
  const session = await requireSession(claims.sid);
  const caller = { userId: claims.sub, sessionId: session.id, tenantId: session.tenantId ?? null };
  bindActor({ userId: caller.userId, tenantId: caller.tenantId });
  return caller;
}

/**
 * The tenant context for a request: authenticated caller + a membership read from the
 * database. The tenant is the one the *session* is acting for — never a header or a body
 * field, which would be a claim, not a fact.
 */
export async function tenantContextFor(request: Request, config: ApiConfig = apiConfig()): Promise<TenantContext> {
  const caller = await authenticate(request, config);
  if (!caller.tenantId) throw errors.forbidden('choose a store first');
  const actor = await actorOf(caller.userId);
  return buildTenantContext({
    actor: { userId: actor.userId, email: actor.email, isStaff: actor.isStaff },
    tenantId: caller.tenantId,
    requestId: currentScope()?.requestId ?? 'unscoped',
  });
}

/** JSON with no-store: nothing an API returns about a session belongs in a shared cache. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('cache-control', 'no-store');
  return Response.json(body, { ...init, headers });
}
