/**
 * T61 — connecting a Zid store, as Zid's public documentation and its App Activation & OAuth Policy
 * (docs.zid.sa, read 2026-09-30) require; a real partner app confirms it.
 *
 * Zid's standard OAuth code flow, from either entry the policy names:
 *  - **Activate** in the Zid App Market (the standard path): Zid opens our app address, which starts
 *    OAuth at once (API-085) — no Tajribah sign-in first;
 *  - **Connect Zid** on Store connections (a secondary entry for signed-in merchants, API-084).
 *
 * The `state` is random, one-time, short-lived and bound to the browser that started it: a signed
 * payload carrying a nonce that must match a short-lived HttpOnly cookie, cleared at the callback.
 * The callback (API-086) exchanges the code at once on the server — the policy forbids holding a code —
 * and identifies the store from Zid's own answer (the manager profile). A store already linked takes
 * the new tokens (a reinstall or re-authorization — no duplicate). Otherwise the access waits, sealed,
 * in `store_grants` (`grants.ts`), and the merchant finishes on Store connections, signed in (API-087):
 * a 10-minute ticket names the store — and, when a signed-in merchant started it, that store and person,
 * which must be the ones linking. On linking, Tajribah subscribes to the store's product webhooks.
 *
 * Zid's uninstall notice is an app-level webhook whose shape the docs do not give; until it is seen,
 * an uninstalled store is found at its next request (401 → the connection is revoked).
 */
import type { ConnectionSummary } from '@/lib/view-models';
import { ZID_API, ZID_OAUTH, zidCredentials, zidToken, type ZidCredentials } from '@/server/connectors/zid/connector';
import { Transport } from '@/server/connectors/transport';
import type { TokenSet } from '@/server/connectors/types';
import { keyedHash, timingSafeEqual } from '@/server/core/auth/crypto';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';
import type { TenantContext } from '@/server/core/tenancy/context';
import { requestSync } from '@/server/modules/sync/service';
import { dropGrant, holdGrant, linkedConnection, noStoreYet, renewLinkedTokens, signLinkTicket, verifyLinkTicket, waitingGrant } from './grants';
import { connectStore } from './service';

export type ZidConnectConfig = { clientId: string; clientSecret: string; redirectUri: string; authSecret: string; appUrl: string };

export const ZID_STATE_COOKIE = 'tajribah_zid_state';
export const STATE_TTL_MS = 10 * 60_000;
/** The product events Tajribah subscribes a linked store to; `product.publish` is a change too. */
export const ZID_WEBHOOK_EVENTS = ['product.create', 'product.update', 'product.publish', 'product.delete'] as const;
const CONNECTIONS = '/dashboard/connections';

const enc = new TextEncoder();
const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(enc.encode(a), enc.encode(b));
const b64 = (text: string) => btoa(String.fromCharCode(...enc.encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
const randomNonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

type State = { n: string; e: number; t?: string; u?: string };

// ------------------------------------------------------------------ starting (API-084, API-085)

/** Zid's approval screen for our app, and the nonce the browser keeps in `ZID_STATE_COOKIE`. */
export async function startZid(config: ZidConnectConfig, startedBy: { t: string; u: string } | null, now = Date.now()): Promise<{ authorizeUrl: string; nonce: string }> {
  const nonce = randomNonce();
  const payload = b64(JSON.stringify({ n: nonce, e: now + STATE_TTL_MS, ...(startedBy ?? {}) } satisfies State));
  const state = `${payload}.${await keyedHash(config.authSecret, 'zid-state', payload)}`;
  const authorize = new URL('/oauth/authorize', ZID_OAUTH);
  authorize.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', state }).toString();
  return { authorizeUrl: authorize.toString(), nonce };
}

/** API-084 — a signed-in merchant connects their Zid store from Store connections (Growth and up). */
export async function startZidFromDashboard(ctx: TenantContext, config: ZidConnectConfig, now = Date.now()) {
  ctx.require('connections:write');
  assertFeature(await entitlementsOf(ctx), 'zid');
  return startZid(config, { t: ctx.tenantId, u: ctx.actor.userId }, now);
}

async function verifyState(state: string, nonce: string | null, secret: string, now: number): Promise<State | null> {
  const [payload, mac] = state.split('.');
  if (!payload || !mac || !sameText(await keyedHash(secret, 'zid-state', payload), mac)) return null;
  let parsed: State;
  try { parsed = JSON.parse(unb64(payload)) as State; } catch { return null; }
  if (typeof parsed.e !== 'number' || parsed.e < now || typeof parsed.n !== 'string' || !nonce || !sameText(parsed.n, nonce)) return null;
  return parsed;
}

// ------------------------------------------------------------------ the callback (API-086)

type Granted = { access_token?: string; Authorization?: string; authorization?: string; refresh_token?: string; expires_in?: number };

function headersFor(c: Pick<ZidCredentials, 'authorization' | 'manager'>) {
  return { authorization: `Bearer ${c.authorization}`, 'x-manager-token': c.manager, 'accept-language': 'en', accept: 'application/json' };
}

/** The store Zid's tokens open, from Zid's own answer (the manager profile). */
async function storeOf(c: Pick<ZidCredentials, 'authorization' | 'manager'>, transport: Transport): Promise<{ id: string; title: string | null; url: string | null }> {
  const response = await transport.send('zid-profile', `${ZID_API}/managers/account/profile`, { headers: headersFor(c) });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw errors.conflict('Zid no longer accepts this store’s access — connect it again from Zid');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw errors.upstream('zid', new Error(`profile: ${response.status}`));
  }
  const body = await response.json() as { user?: { store?: { id?: unknown; title?: unknown; url?: unknown } } };
  const store = body.user?.store;
  const id = typeof store?.id === 'number' || (typeof store?.id === 'string' && /^\d{1,19}$/.test(store.id)) ? String(store.id) : null;
  if (!id) throw errors.upstream('zid', new Error('profile: no store in the answer'));
  const title = typeof store?.title === 'string' && store.title.trim() ? store.title.trim().slice(0, 200) : null;
  const url = typeof store?.url === 'string' && /^https:\/\//.test(store.url) ? store.url : null;
  return { id, title, url };
}

/**
 * Zid sent the merchant back with `code` and `state` (or with an error). Where to send them next:
 * Store connections, with a ticket to finish linking, `zid=renewed` for a store already linked, or
 * `zid_error=…` — never an error page that loses the journey.
 */
export async function completeZidCallback(query: URLSearchParams, nonce: string | null, config: ZidConnectConfig,
  deps: { transport?: Transport; now?: number; requestId?: string } = {}): Promise<string> {
  const back = (params: Record<string, string>) => `${CONNECTIONS}?${new URLSearchParams(params).toString()}`;
  const state = await verifyState(query.get('state') ?? '', nonce, config.authSecret, deps.now ?? Date.now());
  if (!state) return back({ zid_error: 'state' }); // forged, replayed, expired, or another browser's
  if (query.get('error') || !query.get('code')) return back({ zid_error: 'denied' });

  const transport = deps.transport ?? new Transport('zid');
  const response = await transport.send('zid-oauth', `${ZID_OAUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, code: query.get('code')! }).toString(),
  });
  const body = await response.json().catch(() => null) as (Granted & { message?: { description?: string } }) | null;
  if (/client authentication failed/i.test(body?.message?.description ?? '')) {
    log.error('Zid refused the app’s own keys — check ZID_CLIENT_ID / ZID_CLIENT_SECRET');
    return back({ zid_error: 'setup' });
  }
  const authorization = body?.Authorization ?? body?.authorization;
  if (!response.ok || !body?.access_token || !authorization) return back({ zid_error: response.status >= 500 ? 'unavailable' : 'code' });

  let store: Awaited<ReturnType<typeof storeOf>>;
  try {
    store = await storeOf({ authorization, manager: body.access_token }, transport);
  } catch (error) {
    log.warn('zid callback: the store could not be identified', { error: error instanceof Error ? error.message : String(error) });
    return back({ zid_error: 'unavailable' });
  }
  const tokens: TokenSet = {
    accessToken: zidToken({ authorization, manager: body.access_token, storeId: store.id }),
    refreshToken: body.refresh_token ?? null,
    expiresAt: typeof body.expires_in === 'number' && body.expires_in > 0 ? new Date((deps.now ?? Date.now()) + body.expires_in * 1000) : null,
  };
  if (await renewLinkedTokens('zid', store.id, tokens, deps.requestId ?? 'zid-callback')) return back({ zid: 'renewed' });
  await holdGrant('zid', store.id, tokens);
  const startedBy = state.t && state.u ? { t: state.t, u: state.u } : null;
  return back({ zid: await signLinkTicket('zid', store.id, config.authSecret, startedBy, deps.now) });
}

// ------------------------------------------------------------------ linking (API-087)

/** The Basic-auth password Zid sends back with a store's webhook: ours, for that store and event only. */
export const zidWebhookPassword = (secret: string, username: string) => keyedHash(secret, 'zid-webhook', username);

/** Subscribe a linked store to its product webhooks. Best effort: a failure is logged, the hourly sync still runs. */
export async function subscribeZidWebhooks(c: ZidCredentials, config: ZidConnectConfig, transport: Transport): Promise<number> {
  let made = 0;
  for (const event of ZID_WEBHOOK_EVENTS) {
    const username = `${c.storeId}.${event}`;
    try {
      const response = await transport.send(`zid:${c.storeId}`, `${ZID_API}/managers/webhooks`, {
        method: 'POST',
        headers: { ...headersFor(c), 'content-type': 'application/json' },
        body: JSON.stringify({ event, target_url: new URL('/api/webhooks/zid', config.appUrl).toString(), original_id: config.clientId, conditions: null, username, password: await zidWebhookPassword(config.clientSecret, username) }),
      });
      await response.body?.cancel();
      if (response.ok) made += 1;
      else log.warn('zid webhook not subscribed', { event, status: response.status });
    } catch (error) {
      log.warn('zid webhook not subscribed', { event, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return made;
}

/** API-087 — the signed-in merchant links the Zid store the ticket names to their Tajribah store. */
export async function linkZidStore(ctx: TenantContext, ticket: string, config: ZidConnectConfig, deps: { transport?: Transport; now?: number } = {}): Promise<ConnectionSummary> {
  ctx.require('connections:write');
  assertFeature(await entitlementsOf(ctx), 'zid');
  const refused = () => errors.forbidden('this link has expired or did not come from Zid — connect again from Zid or from Store connections');
  const parsed = await verifyLinkTicket('zid', ticket, config.authSecret, deps.now ?? Date.now(), refused);
  // Started from a signed-in page: only that store, by that person, may finish it.
  if ((parsed.t || parsed.u) && (parsed.t !== ctx.tenantId || parsed.u !== ctx.actor.userId)) throw refused();

  const grant = await waitingGrant('zid', parsed.m);
  if (!grant) throw (await linkedConnection('zid', parsed.m)) ? errors.conflict('this Zid store is already linked') : noStoreYet('Zid');
  if (!grant.tokens) throw errors.conflict('this store’s access could not be read — connect it again from Zid');

  const transport = deps.transport ?? new Transport('zid');
  const credentials = zidCredentials(grant.tokens.accessToken);
  const store = await storeOf(credentials, transport);
  if (store.id !== parsed.m || credentials.storeId !== parsed.m) throw errors.forbidden('Zid’s access is for a different store than this link'); // never cross two stores

  const connection = await connectStore(ctx, { provider: 'zid', externalStoreId: parsed.m, storeName: store.title, storeUrl: store.url, tokens: grant.tokens });
  await dropGrant(grant.id);
  await subscribeZidWebhooks(credentials, config, transport);
  await requestSync(ctx, connection.id, { type: 'full', triggeredBy: 'user' });
  return connection;
}
