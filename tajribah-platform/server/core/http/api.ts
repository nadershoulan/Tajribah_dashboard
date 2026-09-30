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
import { buildStaffViewContext, buildTenantContext, type TenantContext } from '../tenancy/context';

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

/**
 * `staffViewUntil` (A4b): this session is a staff member's read-only view of `tenantId` until then.
 * `ssoTenantId` (P8): signed in through that store's single sign-on — the session acts for it alone.
 */
export type Caller = { userId: string; sessionId: string; tenantId: string | null; staffViewUntil: Date | null; ssoTenantId: string | null };

const SSO_ONLY = 'you signed in with your store’s single sign-on, which opens that store only — sign in with your Tajribah password for this';

/**
 * P8 — account-wide actions (another store, two-step sign-in, invitations, the staff console) need a
 * sign-in of the person's own. A store's identity provider vouches for that store only: were an SSO
 * session allowed these, whoever runs the provider could reach the person's other stores.
 */
export function requireOwnSignIn(caller: Caller): void {
  if (caller.ssoTenantId) throw errors.forbidden(SSO_ONLY);
}

/** The authenticated caller, or 401. Binds the user (and tenant) to every later log line. */
export async function authenticate(request: Request, config: ApiConfig = apiConfig()): Promise<Caller> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw errors.unauthenticated();
  const claims = await readAccessToken(match[1], config.authSecret);
  const session = await requireSession(claims.sid);
  const caller = { userId: claims.sub, sessionId: session.id, tenantId: session.tenantId ?? null, staffViewUntil: session.impersonatingUntil ?? null, ssoTenantId: session.ssoTenantId ?? null };
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
  if (caller.ssoTenantId && caller.tenantId !== caller.ssoTenantId) throw errors.forbidden(SSO_ONLY); // P8: never another store
  const actor = await actorOf(caller.userId);
  if (caller.staffViewUntil) {
    // A4b: a staff view ends at its time, whatever the page is still asking for.
    if (caller.staffViewUntil.getTime() <= Date.now()) throw errors.forbidden('the staff view of this store has ended');
    return buildStaffViewContext({
      actor: { userId: actor.userId, email: actor.email, isStaff: actor.isStaff },
      tenantId: caller.tenantId,
      requestId: currentScope()?.requestId ?? 'unscoped',
    });
  }
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
