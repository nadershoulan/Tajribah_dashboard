/**
 * P8 — single sign-on (Enterprise), with the store's own OpenID Connect provider (Microsoft Entra,
 * Google Workspace, Okta, Keycloak…).
 *
 * **The store's side.** Owners and admins set the provider — issuer, client id and secret (sealed
 * under ENCRYPTION_KEY, bound to the store, never shown again), and, optionally, the email domains it
 * may vouch for. Switching it on first asks the provider for its discovery document, so a mistyped
 * issuer fails here rather than at someone's sign-in. Every change is in the store's audit log.
 *
 * **Signing in** starts from the store's address (`/login/sso?store=…`), never from an email domain —
 * so no store can claim someone else's domain and draw their people to its provider:
 *  1. `startSsoSignIn` — the store's provider, a fresh state, nonce and PKCE verifier; those go in a
 *     short-lived, signed, HttpOnly cookie on this browser (10 minutes), the person to the provider.
 *  2. `completeSsoSignIn` — back with a code: the cookie must be ours, fresh and carry this `state`;
 *     the code is exchanged once; the ID token is verified (`oidc.ts`); the provider must say the
 *     address is verified, and it must be in the store's domains when some are set.
 *  3. **Only existing members.** The identity is found by (issuer, subject); the first time, it is
 *     linked to the member of *this store* with that address. Nobody else gets in — no account is
 *     made on the fly.
 *  4. The session is **locked to this store** (`sessions.sso_tenant_id`): no other store, no
 *     account-wide change (`requireOwnSignIn`). The provider vouches for this store, nothing more.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { ssoConnections, ssoIdentities, tenantMemberships, tenants, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { errors } from '@/server/core/errors/problem';
import { assertFeature, entitlementsOf, planHasFeature } from '@/server/core/billing/entitlements';
import { decryptSecret, encryptSecret, keyedHash, timingSafeEqual } from '@/server/core/auth/crypto';
import { issueSession, type IssuedSession, type SessionSecrets } from '@/server/core/auth/session';
import { auditedInsert, auditedUpdate } from '@/server/core/audit/audit';
import { log } from '@/server/core/observability/log';
import type { TenantContext } from '@/server/core/tenancy/context';
import {
  OidcError, authorizeUrl, discover, exchangeCode, normaliseIssuer, signInSecrets, verifyIdToken, type OidcOptions,
} from '@/server/core/auth/oidc';

export const FLOW_TTL_MS = 10 * 60_000;
export const FLOW_COOKIE = 'tj_sso';
export type SsoKeys = { current: string; previous?: string };
export type SsoSettings = {
  configured: boolean; enabled: boolean; issuer: string | null; clientId: string | null; emailDomains: string[];
  /** Paste into the provider as the allowed redirect (sign-in) address. */
  redirectUri: string;
  /** Where the store's people sign in. */
  signInUrl: string;
  updatedAt: string | null;
};

const enc = new TextEncoder();
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const redirectUriFor = (appUrl: string) => `${appUrl}/login/sso`;
const bound = (tenantId: string) => `sso:${tenantId}`;

// ------------------------------------------------------------------ the store's settings

export async function ssoSettings(ctx: TenantContext, appUrl: string): Promise<SsoSettings> {
  ctx.require('settings:read');
  const row = await ctx.db.findOne(ssoConnections, eq(ssoConnections.tenantId, ctx.tenantId));
  return {
    configured: !!row, enabled: row?.enabled ?? false, issuer: row?.issuer ?? null, clientId: row?.clientId ?? null,
    emailDomains: row?.emailDomains ?? [], redirectUri: redirectUriFor(appUrl),
    signInUrl: `${appUrl}/login/sso?store=${encodeURIComponent(ctx.tenant.slug)}`, updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

export type SsoInput = { issuer: string; clientId: string; clientSecret: string | null; emailDomains: string[]; enabled: boolean };

export async function saveSsoSettings(ctx: TenantContext, input: SsoInput, config: { appUrl: string; keys: SsoKeys }, options: OidcOptions = {}): Promise<SsoSettings> {
  ctx.require('settings:write');
  assertFeature(await entitlementsOf(ctx), 'sso');
  const fields: Record<string, string[]> = {};
  let issuer = '';
  try { issuer = normaliseIssuer(input.issuer, options); } catch (error) { fields.issuer = [(error as Error).message.replace(/^issuer: /, '')]; }
  const clientId = input.clientId.trim();
  if (!clientId || clientId.length > 300) fields.clientId = ['the client (application) id from your provider'];
  const domains = [...new Set(input.emailDomains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
  if (domains.length > 20 || domains.some((d) => !DOMAIN.test(d))) fields.emailDomains = ['domains like bigco.sa, up to 20'];
  const existing = await ctx.db.findOne(ssoConnections, eq(ssoConnections.tenantId, ctx.tenantId));
  const secret = input.clientSecret?.trim() || null;
  if (!existing && !secret) fields.clientSecret = ['the client secret from your provider'];
  if (secret && secret.length > 1000) fields.clientSecret = ['too long to be a client secret'];
  if (Object.keys(fields).length) throw errors.validation(fields);
  if (input.enabled) {
    // Switching on: the provider must answer as the issuer it claims to be, now.
    try { await discover(issuer, options); } catch (error) {
      throw errors.validation({ issuer: [`the provider did not answer as ${issuer} (${error instanceof OidcError ? error.message : 'unreachable'})`] });
    }
  }
  const patch = {
    issuer, clientId, emailDomains: domains, enabled: input.enabled,
    ...(secret ? { clientSecretEncrypted: await encryptSecret(secret, config.keys.current, bound(ctx.tenantId)) } : {}),
  };
  // The audit log never holds the sealed secret: `record` drops every field named like a secret.
  if (existing) await auditedUpdate(ctx, ssoConnections, existing.id, { ...patch, updatedAt: new Date() }, { resourceType: 'sso_connection' });
  else await auditedInsert(ctx, ssoConnections, { id: uuidv7(), tenantId: ctx.tenantId, createdBy: ctx.actor.userId, ...patch }, { resourceType: 'sso_connection' });
  return ssoSettings(ctx, config.appUrl);
}

// ------------------------------------------------------------------ signing in

type Flow = { t: string; s: string; n: string; v: string; e: number };
const b64 = (text: string) => btoa(String.fromCharCode(...enc.encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
const same = (a: string, b: string) => timingSafeEqual(enc.encode(a), enc.encode(b));
const refused = () => errors.forbidden('this sign-in did not start here, or took too long — start again from your store’s sign-in page');

async function sealFlow(flow: Flow, authSecret: string): Promise<string> {
  const payload = b64(JSON.stringify(flow));
  return `${payload}.${await keyedHash(authSecret, 'sso-flow', payload)}`;
}

async function openFlow(cookie: string | null, authSecret: string, now: number): Promise<Flow> {
  const [payload, mac] = (cookie ?? '').split('.');
  if (!payload || !mac || !same(await keyedHash(authSecret, 'sso-flow', payload), mac)) throw refused();
  let flow: Flow;
  try { flow = JSON.parse(unb64(payload)) as Flow; } catch { throw refused(); }
  if (typeof flow.e !== 'number' || flow.e < now) throw refused();
  return flow;
}

export function flowCookie(value: string, secure: boolean): string {
  return `${FLOW_COOKIE}=${value}; Path=/api/auth/sso; HttpOnly; SameSite=Lax; Max-Age=${FLOW_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}
export const clearFlowCookie = (secure: boolean) => `${FLOW_COOKIE}=; Path=/api/auth/sso; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
export function readFlowCookie(header: string | null): string | null {
  for (const part of (header ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === FLOW_COOKIE) return rest.join('=') || null;
  }
  return null;
}

/** The store's enabled provider, by the store's address — the same answer for "no such store" and "no SSO". */
async function providerOf(where: { slug: string } | { tenantId: string }) {
  const db = unsafeAdminDb(); // before any session: a platform lookup, as a password sign-in's is
  const [row] = await db.select({ tenant: tenants, sso: ssoConnections }).from(ssoConnections)
    .innerJoin(tenants, eq(tenants.id, ssoConnections.tenantId))
    .where(and('slug' in where ? eq(tenants.slug, where.slug.trim().toLowerCase()) : eq(tenants.id, where.tenantId), eq(ssoConnections.enabled, true), isNull(tenants.deletedAt)))
    .limit(1);
  if (!row || !(await planHasFeature(row.tenant, 'sso'))) throw errors.notFound('single sign-on for this store');
  return row;
}

export async function startSsoSignIn(store: string, config: { appUrl: string; authSecret: string }, options: OidcOptions = {}, now = Date.now()): Promise<{ authorizeUrl: string; flow: string }> {
  const { tenant, sso } = await providerOf({ slug: store });
  const provider = await discover(sso.issuer, options).catch(() => { throw errors.upstream('sso', new Error('the store’s sign-in provider did not answer')); });
  const secrets = await signInSecrets();
  const flow = await sealFlow({ t: tenant.id, s: secrets.state, n: secrets.nonce, v: secrets.verifier, e: now + FLOW_TTL_MS }, config.authSecret);
  return {
    authorizeUrl: authorizeUrl(provider, { clientId: sso.clientId, redirectUri: redirectUriFor(config.appUrl), state: secrets.state, nonce: secrets.nonce, challenge: secrets.challenge }),
    flow,
  };
}

export async function completeSsoSignIn(input: { code: string; state: string; flowCookie: string | null; userAgent?: string | null; ip?: string | null },
  config: SessionSecrets & { appUrl: string; keys: SsoKeys }, options: OidcOptions = {}, now = Date.now()): Promise<IssuedSession> {
  const flow = await openFlow(input.flowCookie, config.authSecret, now);
  if (!input.state || !same(input.state, flow.s)) throw refused();
  const { tenant, sso } = await providerOf({ tenantId: flow.t });
  const clientSecret = await decryptSecret(sso.clientSecretEncrypted, [config.keys.current, ...(config.keys.previous ? [config.keys.previous] : [])], bound(tenant.id));
  if (!clientSecret) throw errors.upstream('sso', new Error('the client secret could not be opened'));

  let claims;
  try {
    const provider = await discover(sso.issuer, options);
    const idToken = await exchangeCode(provider, { code: input.code, verifier: flow.v, redirectUri: redirectUriFor(config.appUrl), clientId: sso.clientId, clientSecret }, options);
    claims = await verifyIdToken(idToken, { provider, clientId: sso.clientId, nonce: flow.n }, options, now);
  } catch (error) {
    if (!(error instanceof OidcError)) throw error;
    log.warn('sso sign-in refused', { tenantId: tenant.id, why: error.message });
    throw errors.forbidden('your store’s sign-in provider did not confirm who you are — try again, or ask your store’s admin');
  }
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email || claims.email_verified !== true) throw errors.forbidden('your sign-in provider did not confirm your email address');
  if (sso.emailDomains.length && !sso.emailDomains.includes(email.split('@')[1] ?? '')) throw errors.forbidden('this store’s single sign-on is for its own email domains');

  const db = unsafeAdminDb();
  const userId = await db.transaction(async (tx) => {
    const [known] = await tx.select().from(ssoIdentities).where(and(eq(ssoIdentities.tenantId, tenant.id), eq(ssoIdentities.issuer, sso.issuer), eq(ssoIdentities.subject, claims.sub))).limit(1);
    // A linked identity still needs its person to be an active member now; a first sign-in is linked
    // to the member of this store with the verified address, and to no one else.
    const [member] = await tx.select({ userId: users.id }).from(users)
      .innerJoin(tenantMemberships, and(eq(tenantMemberships.userId, users.id), eq(tenantMemberships.tenantId, tenant.id), eq(tenantMemberships.status, 'active')))
      .where(and(known ? eq(users.id, known.userId) : eq(users.email, email), isNull(users.deletedAt))).limit(1);
    if (!member) return null;
    if (known) await tx.update(ssoIdentities).set({ lastLoginAt: new Date(now) }).where(eq(ssoIdentities.id, known.id));
    else await tx.insert(ssoIdentities).values({ id: uuidv7(), tenantId: tenant.id, userId: member.userId, issuer: sso.issuer, subject: claims.sub, lastLoginAt: new Date(now) });
    await tx.update(users).set({ lastLoginAt: new Date(now) }).where(eq(users.id, member.userId));
    return member.userId;
  });
  if (!userId) throw errors.forbidden('you are not a member of this store yet — ask its admin to invite you');
  log.info('sso sign-in', { tenantId: tenant.id, userId });
  return issueSession({ userId, tenantId: tenant.id, ssoTenantId: tenant.id, userAgent: input.userAgent, ip: input.ip, config });
}
