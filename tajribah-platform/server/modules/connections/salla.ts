/**
 * P1.4 / T61 — connecting a Salla store, as Salla's public documentation describes it (docs.salla.dev,
 * read 2026-09-30); a real partner app confirms it (P1.4).
 *
 * Salla allows published apps one way in, its "easy mode": the merchant installs Tajribah from the
 * Salla App Store, and Salla **sends the store's tokens to our webhook** (`app.store.authorize`) — no
 * redirect, so nothing yet says which Tajribah account the store belongs to. Linking it takes proof
 * from each side:
 *
 *  1. **The tokens** arrive signed by Salla (the webhook signature). No account has the store yet, so
 *     they wait in `store_grants`, sealed and bound to the row; a store already linked gets them on its
 *     connection instead (a reinstall, or Salla re-authorizing after an app update).
 *  2. **The store** is proven by Salla itself: the merchant opens Tajribah inside the Salla dashboard,
 *     Salla loads our app page with a short-lived session token, and the server asks Salla who it
 *     belongs to (`exchange-authority/v1/introspect`, with our app id). Only then is a **link ticket**
 *     issued: that store, 10 minutes, signed here (its own purpose — no other token of ours passes).
 *  3. **The account** is the merchant's own session: the ticket opens Tajribah in a new tab, and the
 *     signed-in merchant's link spends it — the tokens move onto their store's connection (checked
 *     against the store they open), the grant row is deleted, and the first sync starts.
 *
 * An uninstall before linking deletes the waiting grant. Tokens are never logged, never stored with
 * the webhook event (`webhooks/salla.ts` redacts them) and never returned by an endpoint.
 */
import { and, eq } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { storeConnections, storeGrants, type StoreConnection } from '@/db/schema';
import type { ConnectionSummary, SallaAppView } from '@/lib/view-models';
import { uuidv7 } from '@/lib/ids';
import { SALLA_ACCOUNTS } from '@/server/connectors/salla/connector';
import { Transport } from '@/server/connectors/transport';
import type { TokenSet } from '@/server/connectors/types';
import { record } from '@/server/core/audit/audit';
import { keyedHash, timingSafeEqual } from '@/server/core/auth/crypto';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { errors, isUniqueViolation } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';
import { systemContext, type TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { requestSync } from '@/server/modules/sync/service';
import { connectStore, vaultKeys } from './service';
import { openTokens, sealTokens } from './vault';

export const SALLA_INTROSPECT = 'https://api.salla.dev/exchange-authority/v1/introspect';
export const LINK_TTL_MS = 10 * 60_000;

export type SallaLinkConfig = { appId: string; authSecret: string };

const numeric = (v: unknown): v is number | string => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) || (typeof v === 'string' && /^\d{1,19}$/.test(v));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const enc = new TextEncoder();
const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(enc.encode(a), enc.encode(b));
const b64 = (text: string) => btoa(String.fromCharCode(...enc.encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

// ------------------------------------------------------------------ 1. the tokens, from Salla's webhook

/** The tokens in an `app.store.authorize` delivery; `expires` there is a Unix time (Salla's note). */
export function authorizeTokens(data: unknown, now = Date.now()): TokenSet | null {
  if (!isObj(data) || typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token) return null;
  const expires = typeof data.expires === 'number' && data.expires > 0
    ? new Date(data.expires > 1e9 ? data.expires * 1000 : now + data.expires * 1000) // a Unix time — or, should Salla send seconds from now, that
    : null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: expires,
    scopes: typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : null,
  };
}

async function connectionFor(merchant: string): Promise<Pick<StoreConnection, 'id' | 'tenantId'> | null> {
  const [row] = await unsafeAdminDb().select({ id: storeConnections.id, tenantId: storeConnections.tenantId }).from(storeConnections)
    .where(and(eq(storeConnections.provider, 'salla'), eq(storeConnections.externalStoreId, merchant))).limit(1);
  return row ?? null;
}

/**
 * Salla handed over a store's tokens (a verified `app.store.authorize`). A linked store's connection
 * takes them at once and works again; otherwise they wait for the merchant to link the store.
 */
export async function receiveSallaAuthorize(merchant: unknown, data: unknown, requestId: string): Promise<'connection' | 'grant' | 'ignored'> {
  const tokens = authorizeTokens(data);
  if (!numeric(merchant) || !tokens) return 'ignored';
  const store = String(merchant);
  const key = vaultKeys().current;

  const connection = await connectionFor(store);
  if (connection) {
    const ctx = await systemContext({ tenantId: connection.tenantId, requestId, permissions: ['connections:write'], evenIfSuspended: true });
    await withTenant(connection.tenantId, async (db) => {
      const before = await db.lockById(storeConnections, connection.id);
      const after = await db.updateById(storeConnections, connection.id, { ...(await sealTokens(connection.id, tokens, key)), status: 'active', lastError: null });
      await record(ctx, { action: 'update', actorType: 'system', resourceType: 'store_connection', resourceId: connection.id, before, after }, db);
    });
    log.info('salla tokens renewed on the linked store', { connectionId: connection.id });
    return 'connection';
  }

  for (let attempt = 0; ; attempt++) {
    const [waiting] = await unsafeAdminDb().select({ id: storeGrants.id }).from(storeGrants)
      .where(and(eq(storeGrants.provider, 'salla'), eq(storeGrants.externalStoreId, store))).limit(1);
    try {
      if (waiting) {
        await unsafeAdminDb().update(storeGrants).set({ ...(await sealTokens(waiting.id, tokens, key)), updatedAt: new Date() }).where(eq(storeGrants.id, waiting.id));
      } else {
        const id = uuidv7();
        await unsafeAdminDb().insert(storeGrants).values({ id, provider: 'salla', externalStoreId: store, ...(await sealTokens(id, tokens, key)) });
      }
      log.info('salla tokens waiting for the store to be linked');
      return 'grant';
    } catch (error) {
      if (!isUniqueViolation(error) || attempt > 0) throw error; // two deliveries at once: the second updates
    }
  }
}

/** The app was uninstalled before the store was linked: its waiting access goes. */
export async function forgetSallaGrant(merchant: unknown): Promise<void> {
  if (!numeric(merchant)) return;
  await unsafeAdminDb().delete(storeGrants).where(and(eq(storeGrants.provider, 'salla'), eq(storeGrants.externalStoreId, String(merchant))));
}

// ------------------------------------------------------------------ 2. the store, proven by Salla

/** Which store Salla says the app page's session token belongs to — or refused. */
export async function introspectSalla(token: string, appId: string, transport: Transport = new Transport('salla')): Promise<string> {
  const refused = () => errors.forbidden('Salla did not confirm this session — open Tajribah again from your Salla dashboard');
  if (!token || token.length > 4096) throw refused();
  const response = await transport.send('salla-introspect', SALLA_INTROSPECT, {
    method: 'POST',
    headers: { 's-source': appId, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (response.status >= 500) {
    await response.body?.cancel();
    throw errors.upstream('salla', new Error(`introspect: ${response.status}`));
  }
  const body = await response.json().catch(() => null) as { success?: boolean; data?: { merchant_id?: unknown } } | null;
  if (!response.ok || body?.success !== true || !numeric(body.data?.merchant_id)) throw refused();
  return String(body.data.merchant_id);
}

type Ticket = { m: string; e: number };

export async function signLinkTicket(merchant: string, secret: string, now = Date.now()): Promise<string> {
  const payload = b64(JSON.stringify({ m: merchant, e: now + LINK_TTL_MS } satisfies Ticket));
  return `${payload}.${await keyedHash(secret, 'salla-link', payload)}`;
}

async function verifyLinkTicket(ticket: string, secret: string, now: number): Promise<string> {
  const refused = () => errors.forbidden('this link has expired or did not come from your Salla dashboard — open Tajribah again from Salla');
  const [payload, mac] = ticket.split('.');
  if (!payload || !mac || !sameText(await keyedHash(secret, 'salla-link', payload), mac)) throw refused();
  let parsed: Ticket;
  try { parsed = JSON.parse(unb64(payload)) as Ticket; } catch { throw refused(); }
  if (typeof parsed.e !== 'number' || parsed.e < now || !numeric(parsed.m)) throw refused();
  return parsed.m;
}

export type SallaAppState = SallaAppView;

/** API-068 — the app page inside Salla: which store this is, and a ticket to link it. */
export async function openSallaApp(token: string, config: SallaLinkConfig, deps: { transport?: Transport; now?: number } = {}): Promise<SallaAppState> {
  const merchant = await introspectSalla(token, config.appId, deps.transport);
  const connection = await connectionFor(merchant);
  const [grant] = await unsafeAdminDb().select({ id: storeGrants.id }).from(storeGrants)
    .where(and(eq(storeGrants.provider, 'salla'), eq(storeGrants.externalStoreId, merchant))).limit(1);
  return {
    linked: !!connection,
    ready: !!connection || !!grant,
    ticket: connection ? null : await signLinkTicket(merchant, config.authSecret, deps.now),
  };
}

// ------------------------------------------------------------------ 3. the account: linking

type UserInfo = { data?: { merchant?: { id?: unknown; name?: unknown; domain?: unknown }; store?: { id?: unknown; name?: unknown } } };

/** The store a Salla access token opens (Salla's user-info answer shows it as `merchant` or `store`). */
async function storeOf(accessToken: string, transport: Transport): Promise<{ id: string; name: string | null; url: string | null }> {
  const response = await transport.send('salla-accounts', `${SALLA_ACCOUNTS}/oauth2/user/info`, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw errors.conflict('Salla no longer accepts this store’s access — reinstall Tajribah from the Salla App Store');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw errors.upstream('salla', new Error(`user info: ${response.status}`));
  }
  const body = await response.json() as UserInfo;
  const store = body.data?.merchant ?? body.data?.store;
  if (!store || !numeric(store.id)) throw errors.upstream('salla', new Error('user info: no store in the answer'));
  const domain = typeof (store as { domain?: unknown }).domain === 'string' && /^https:\/\//.test((store as { domain: string }).domain) ? (store as { domain: string }).domain : null;
  return { id: String(store.id), name: typeof store.name === 'string' && store.name.trim() ? store.name.trim().slice(0, 200) : null, url: domain };
}

/** API-069 — the signed-in merchant links the Salla store the ticket names to their Tajribah store. */
export async function linkSallaStore(ctx: TenantContext, ticket: string, config: SallaLinkConfig, deps: { transport?: Transport; now?: number } = {}): Promise<ConnectionSummary> {
  ctx.require('connections:write');
  assertFeature(await entitlementsOf(ctx), 'salla');
  const merchant = await verifyLinkTicket(ticket, config.authSecret, deps.now ?? Date.now());

  const [grant] = await unsafeAdminDb().select().from(storeGrants)
    .where(and(eq(storeGrants.provider, 'salla'), eq(storeGrants.externalStoreId, merchant))).limit(1);
  if (!grant) {
    throw errors.conflict((await connectionFor(merchant))
      ? 'this Salla store is already linked'
      : 'Salla has not handed over this store’s access yet — wait a minute and try again, or reinstall Tajribah from the Salla App Store');
  }
  const tokens = await openTokens(grant as unknown as StoreConnection, vaultKeys());
  if (!tokens) throw errors.conflict('this store’s access could not be read — reinstall Tajribah from the Salla App Store');

  const store = await storeOf(tokens.accessToken, deps.transport ?? new Transport('salla'));
  if (store.id !== merchant) throw errors.forbidden('Salla’s access is for a different store than this link'); // never cross two stores

  const connection = await connectStore(ctx, { provider: 'salla', externalStoreId: merchant, storeName: store.name, storeUrl: store.url, tokens });
  await unsafeAdminDb().delete(storeGrants).where(eq(storeGrants.id, grant.id));
  await requestSync(ctx, connection.id, { type: 'full', triggeredBy: 'user' });
  return connection;
}
