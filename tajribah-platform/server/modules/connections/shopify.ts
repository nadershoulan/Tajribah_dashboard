/**
 * P6 — connecting a Shopify shop, through Shopify's own install screen (OAuth, offline access,
 * `read_products` only). It needs the Tajribah app registered in a Shopify Partner account:
 * until `SHOPIFY_CLIENT_ID` is set, Shopify is shown as not available yet.
 *
 *  1. `startShopifyConnect` — the merchant names their shop (`name`, `name.myshopify.com`, or its
 *     admin address); we answer with that shop's install screen, carrying a **signed state**: who,
 *     which store of ours, which shop, until when (15 minutes).
 *  2. The merchant approves in Shopify, which sends the browser back to Store connections with
 *     `code`, `shop`, `state`, `timestamp` and an `hmac` over them.
 *  3. The page hands that query to `completeShopifyConnect`, **with the merchant's own session** —
 *     the dashboard's API is token-authenticated, so a bare redirect could never finish a connection
 *     on its own. There: Shopify's HMAC must verify with our app secret (so the code really came from
 *     Shopify); the state must be ours, fresh, and for this very person, store and shop; the code is
 *     exchanged once for the shop's token, which must carry `read_products` and must work; then the
 *     connection is saved (sealed, like every token) and its first sync queued.
 */
import { errors } from '@/server/core/errors/problem';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { keyedHash, timingSafeEqual } from '@/server/core/auth/crypto';
import type { TenantContext } from '@/server/core/tenancy/context';
import { Transport } from '@/server/connectors/transport';
import { connectorFor, TokenRevokedError, type Connector } from '@/server/connectors/types';
import { SHOP_DOMAIN, shopifyToken } from '@/server/connectors/shopify/connector';
import { hmacSha256, toHex } from '@/server/modules/webhooks/sources';
import { requestSync } from '@/server/modules/sync/service';
import type { ConnectionSummary } from '@/lib/view-models';
import { connectStore } from './service';

export const CONNECT_TTL_MS = 15 * 60_000;
export const SHOPIFY_SCOPES = 'read_products';

export type ShopifyAppConfig = { clientId: string; clientSecret: string; authSecret: string; appUrl: string };
type State = { t: string; u: string; s: string; e: number };

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
const enc = new TextEncoder();
const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(enc.encode(a), enc.encode(b));

const refused = () => errors.forbidden('this approval did not come from a connection you started here, or it has expired — start again from Store connections');

async function sign(state: State, secret: string): Promise<string> {
  const payload = b64(JSON.stringify(state));
  return `${payload}.${await keyedHash(secret, 'shopify-connect', payload)}`;
}

async function verifyState(token: string, secret: string, now: number): Promise<State> {
  const [payload, mac] = token.split('.');
  if (!payload || !mac || !sameText(await keyedHash(secret, 'shopify-connect', payload), mac)) throw refused();
  let state: State;
  try { state = JSON.parse(unb64(payload)) as State; } catch { throw refused(); }
  if (typeof state.e !== 'number' || state.e < now) throw refused();
  return state;
}

/** `oud-house`, `oud-house.myshopify.com` or `https://oud-house.myshopify.com/admin` → the shop domain. */
export function shopDomain(input: string): string {
  let text = input.trim().toLowerCase();
  if (/^https?:\/\//.test(text)) {
    try { text = new URL(text).hostname; } catch { text = ''; }
  }
  text = text.replace(/\/.*$/, '');
  const shop = text.endsWith('.myshopify.com') ? text : `${text}.myshopify.com`;
  if (!SHOP_DOMAIN.test(shop)) throw errors.validation({ shop: ['your shop’s name as in its myshopify.com address'] });
  return shop;
}

/**
 * Shopify's check on a redirect: HMAC-SHA256, hex, with the app secret, over every parameter but
 * `hmac` — sorted by name, as `name=value` joined by `&`.
 */
export async function shopifyHmacValid(query: URLSearchParams, clientSecret: string): Promise<boolean> {
  const given = query.get('hmac') ?? '';
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const message = [...query.entries()].filter(([k]) => k !== 'hmac').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  return sameText(toHex(await hmacSha256(clientSecret, message)), given.toLowerCase());
}

export async function startShopifyConnect(ctx: TenantContext, shopInput: string, config: ShopifyAppConfig, now = Date.now()): Promise<{ authorizeUrl: string }> {
  ctx.require('connections:write');
  assertFeature(await entitlementsOf(ctx), 'shopify');
  const shop = shopDomain(shopInput);
  const state = await sign({ t: ctx.tenantId, u: ctx.actor.userId, s: shop, e: now + CONNECT_TTL_MS }, config.authSecret);
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('scope', SHOPIFY_SCOPES);
  authorize.searchParams.set('redirect_uri', `${config.appUrl}/dashboard/connections`);
  authorize.searchParams.set('state', state);
  return { authorizeUrl: authorize.toString() };
}

export async function completeShopifyConnect(ctx: TenantContext, rawQuery: string, config: ShopifyAppConfig, now = Date.now(),
  deps: { transport?: Transport; connector?: Connector } = {}): Promise<ConnectionSummary> {
  ctx.require('connections:write');
  assertFeature(await entitlementsOf(ctx), 'shopify');
  const query = new URLSearchParams(rawQuery.replace(/^\?/, ''));
  if (!(await shopifyHmacValid(query, config.clientSecret))) throw refused();
  const state = await verifyState(query.get('state') ?? '', config.authSecret, now);
  const shop = query.get('shop') ?? '';
  if (state.t !== ctx.tenantId || state.u !== ctx.actor.userId || state.s !== shop || !SHOP_DOMAIN.test(shop)) throw refused();
  const code = query.get('code');
  if (!code) throw errors.validation({ code: ['Shopify did not send an approval code'] });

  // The code, once, for the shop's offline token.
  const transport = deps.transport ?? new Transport('shopify');
  const response = await transport.send(shop, `https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status >= 400 && response.status < 500) throw refused(); // a used or expired code
    throw errors.upstream('shopify', new Error(`access_token: ${response.status}`));
  }
  const granted = await response.json() as { access_token?: string; scope?: string };
  if (!granted.access_token) throw errors.upstream('shopify', new Error('access_token: none in the answer'));
  const scopes = (granted.scope ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!scopes.includes('read_products')) throw errors.validation({ scope: ['Tajribah needs to read products'] });

  const tokens = { accessToken: shopifyToken({ shop, token: granted.access_token }), scopes };
  try {
    await (deps.connector ?? connectorFor('shopify')).refresh(tokens); // the token opens that shop
  } catch (error) {
    if (error instanceof TokenRevokedError) throw errors.validation({ code: ['Shopify’s token does not open that shop'] });
    throw error;
  }
  const connection = await connectStore(ctx, { provider: 'shopify', externalStoreId: shop, storeUrl: `https://${shop}`, storeName: shop, tokens });
  await requestSync(ctx, connection.id, { type: 'full', triggeredBy: 'user' });
  return connection;
}
