/**
 * P6 — connecting a WooCommerce store, with WooCommerce's own approval screen
 * (`/wc-auth/v1/authorize`): no partner account, no keys typed by hand.
 *
 *  1. `startWooConnect` — the merchant gives their store's address; we answer with the store's
 *     approval page, carrying a **signed state** (who, which store of ours, which WooCommerce site,
 *     until when — 15 minutes) as WooCommerce's `user_id`.
 *  2. The owner approves on their own site. WooCommerce then **POSTs the new read keys** to our
 *     callback, from the store's server, with that state; and sends the merchant back to us.
 *  3. `completeWooConnect` — the state must be ours and fresh; the merchant is re-checked as they
 *     are now (still a member who may connect stores, on a plan with WooCommerce); the keys must
 *     **work on the very site the state names** (so keys for one site can never be attached as
 *     another); then the connection is saved (sealed, like every token) and its first sync queued.
 *
 * A second callback with the same state (WooCommerce retrying) finds the same connection and
 * replaces its keys — reconnecting is the same row.
 */
import { errors } from '@/server/core/errors/problem';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { keyedHash, timingSafeEqual } from '@/server/core/auth/crypto';
import { actorOf } from '@/server/core/auth/session';
import { buildTenantContext, type TenantContext } from '@/server/core/tenancy/context';
import { connectorFor, TokenRevokedError, type Connector } from '@/server/connectors/types';
import { wooToken } from '@/server/connectors/woocommerce/connector';
import { safeTarget } from '@/server/modules/embed/check';
import { requestSync } from '@/server/modules/sync/service';
import type { ConnectionSummary } from '@/lib/view-models';
import { connectStore } from './service';

export const CONNECT_TTL_MS = 15 * 60_000;
type State = { t: string; u: string; s: string; e: number };

const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function sign(state: State, secret: string): Promise<string> {
  const payload = b64(JSON.stringify(state));
  return `${payload}.${await keyedHash(secret, 'woo-connect', payload)}`;
}

async function verify(token: string, secret: string, now: number): Promise<State> {
  const [payload, mac] = token.split('.');
  const bad = () => errors.forbidden('this approval did not come from a connection started here, or it has expired — start again from Store connections');
  if (!payload || !mac) throw bad();
  const expected = await keyedHash(secret, 'woo-connect', payload);
  const enc = new TextEncoder();
  if (expected.length !== mac.length || !timingSafeEqual(enc.encode(expected), enc.encode(mac))) throw bad();
  let state: State;
  try { state = JSON.parse(unb64(payload)) as State; } catch { throw bad(); }
  if (typeof state.e !== 'number' || state.e < now) throw bad();
  return state;
}

/** The store address as WooCommerce is reached: https, public, no query, no trailing slash. */
export function wooBase(input: string): string {
  const target = safeTarget(input, null);
  if (!target.ok) throw errors.validation({ storeUrl: [target.reason] });
  const url = new URL(input.trim());
  return `${url.origin}${url.pathname.replace(/\/(wp-admin|wp-login\.php).*$/i, '').replace(/\/+$/, '')}`;
}

export async function startWooConnect(ctx: TenantContext, storeUrl: string, config: { authSecret: string; appUrl: string }, now = Date.now()): Promise<{ authorizeUrl: string }> {
  ctx.require('connections:write');
  assertFeature(await entitlementsOf(ctx), 'woocommerce');
  const base = wooBase(storeUrl);
  const state = await sign({ t: ctx.tenantId, u: ctx.actor.userId, s: base, e: now + CONNECT_TTL_MS }, config.authSecret);
  const authorize = new URL(`${base}/wc-auth/v1/authorize`);
  authorize.searchParams.set('app_name', 'Tajribah');
  authorize.searchParams.set('scope', 'read');
  authorize.searchParams.set('user_id', state);
  authorize.searchParams.set('return_url', `${config.appUrl}/dashboard/connections?woocommerce=returned`);
  authorize.searchParams.set('callback_url', `${config.appUrl}/api/connections/woocommerce/callback`);
  return { authorizeUrl: authorize.toString() };
}

export type WooCallback = { user_id: string; consumer_key: string; consumer_secret: string; key_permissions: string };

export async function completeWooConnect(body: WooCallback, config: { authSecret: string }, requestId: string, now = Date.now(),
  connector: Connector = connectorFor('woocommerce')): Promise<ConnectionSummary> {
  const state = await verify(body.user_id, config.authSecret, now);
  if (!['read', 'read_write'].includes(body.key_permissions)) throw errors.validation({ key_permissions: ['Tajribah needs read access'] });
  // The merchant as they are now — not as they were when they clicked.
  const person = await actorOf(state.u);
  const ctx = await buildTenantContext({ actor: { userId: person.userId, email: person.email, isStaff: false }, tenantId: state.t, requestId });
  const tokens = { accessToken: wooToken({ url: state.s, key: body.consumer_key, secret: body.consumer_secret }), scopes: [body.key_permissions] };
  try {
    await connector.refresh(tokens); // the keys work, on the site the state names
  } catch (error) {
    if (error instanceof TokenRevokedError) throw errors.validation({ consumer_key: ['these keys do not open that store'] });
    throw error;
  }
  const site = new URL(state.s);
  const connection = await connectStore(ctx, {
    provider: 'woocommerce', externalStoreId: `${site.host}${site.pathname === '/' ? '' : site.pathname}`,
    storeUrl: state.s, storeName: site.host, tokens,
  });
  await requestSync(ctx, connection.id, { type: 'full', triggeredBy: 'user' });
  return connection;
}
