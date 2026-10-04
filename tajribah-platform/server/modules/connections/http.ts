/**
 * P1.11 — store connection endpoints. The shapes carry no token field at all
 * (`ConnectionSummary` is built field by field in the service), so nothing here can leak one.
 */
import { z } from 'zod';
import type { ConnectionDetail } from '@/lib/view-models';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { currentScope } from '@/server/core/observability/scope';
import type { TenantContext } from '@/server/core/tenancy/context';
import { latestSync, requestSync } from '@/server/modules/sync/service';
import { webhookHealth } from '@/server/modules/webhooks/service';
import { storeConnections } from '@/db/schema';
import { connectionHealth } from './health';
import { disconnectStore, listConnections } from './service';
import { completeWooConnect, startWooConnect } from './woocommerce';
import { connectFeed, importProductFile } from './feed';
import { completeShopifyConnect, startShopifyConnect, type ShopifyAppConfig } from './shopify';
import { linkSallaStore, openSallaApp, type SallaLinkConfig } from './salla';
import { completeZidCallback, linkZidStore, startZid, startZidFromDashboard, ZID_STATE_COOKIE, STATE_TTL_MS, type ZidConnectConfig } from './zid';
import { zidApp } from '@/server/connectors';
import { loadEnv } from '@/server/core/config/env';

/** The `[id]` segment at `index` from the end. A malformed id is a 404, like a missing one. */
function idFrom(request: Request, fromEnd: number): string {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1 - fromEnd] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('store connection');
  return id;
}

export async function connectionDetails(ctx: TenantContext): Promise<ConnectionDetail[]> {
  const connections = await listConnections(ctx);
  return Promise.all(connections.map(async (c) => ({
    ...c,
    latestSync: await latestSync(ctx, c.id),
    webhooks: await webhookHealth(ctx, c.id),
    health: await connectionHealth(ctx.db, await ctx.db.requireById(storeConnections, c.id)),
  })));
}

/** API-060 — GET /api/connections */
export const listConnectionsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ connections: await connectionDetails(ctx) });
});

/** API-061 — POST /api/connections/[id]/sync → the sync, queued (or the one already running) */
export const requestSyncHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  // Another store's id is a 404 from the row lock inside `requestSync`.
  return json(await requestSync(ctx, idFrom(request, 1), { type: 'incremental', triggeredBy: 'user' }), { status: 202 });
});

/** API-062 — DELETE /api/connections/[id] → tokens forgotten, products kept */
export const disconnectHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  await disconnectStore(ctx, idFrom(request, 0));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});

/** API-184 — POST /api/connections/feed { url }: a Google Merchant feed's link, synced now and every 24 hours. */
export const connectFeedHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const { url } = await readJson(request, z.object({ url: z.string().max(4096) }));
  return json(await connectFeed(ctx, { url }), { status: 201 });
});

/**
 * API-185 — POST /api/connections/feed/file?filename=… with the file itself as the body (CSV, TSV,
 * XLSX or Merchant XML, up to 30 MB): its products are imported in this request; the file is not kept.
 */
export const importProductFileHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > 30 * 1024 * 1024) throw errors.validation({ file: ['the file is larger than 30 MB'] });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) throw errors.validation({ file: ['the file is empty'] });
  const filename = new URL(request.url).searchParams.get('filename') ?? 'products';
  return json(await importProductFile(ctx, { filename, bytes }), { status: 201 });
});

/** API-063 — POST /api/connections/woocommerce/start { storeUrl } → { authorizeUrl } (the store's own approval page) */
export const startWooConnectHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const { storeUrl } = await readJson(request, z.object({ storeUrl: z.string().max(2048) }));
  return json(await startWooConnect(ctx, storeUrl, { authSecret: config.authSecret, appUrl: config.appUrl }));
});

/**
 * API-064 — POST /api/connections/woocommerce/callback: WooCommerce's server hands over the keys the
 * owner approved. No session and no same-origin check (it is the store's server calling); the signed
 * state in `user_id` is the authority, and the keys are tested against the store it names.
 */
export const wooCallbackHandler = route(async (request) => {
  const config = apiConfig();
  const body = await readJson(request, z.object({
    user_id: z.string().max(2048), consumer_key: z.string().min(10).max(200), consumer_secret: z.string().min(10).max(200),
    key_permissions: z.string().max(20), key_id: z.union([z.number(), z.string()]).optional(),
  }));
  await completeWooConnect(body, { authSecret: config.authSecret }, currentScope()?.requestId ?? 'woo-callback');
  return json({ ok: true });
});

/** The Shopify app's keys, or null until it is registered in a Shopify Partner account (P6). */
function shopifyApp(config: { authSecret: string; appUrl: string }): ShopifyAppConfig | null {
  const env = loadEnv();
  return env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET
    ? { clientId: env.SHOPIFY_CLIENT_ID, clientSecret: env.SHOPIFY_CLIENT_SECRET, authSecret: config.authSecret, appUrl: config.appUrl }
    : null;
}
const shopifyNotYet = () => errors.notImplemented('Shopify shops can be connected once the Tajribah Shopify app is registered');

/** API-065 — GET /api/connections/providers: which store platforms can be connected here yet. */
export const connectionProvidersHandler = route(async (request) => {
  const config = apiConfig();
  await tenantContextFor(request, config);
  return json({ woocommerce: true, shopify: shopifyApp(config) !== null, salla: sallaLink(config) !== null, zid: zidConnect(config) !== null, feed: true });
});

/**
 * The Salla app's settings for linking a store, or null until the app is registered in the Salla
 * Partners portal: its id (Salla's introspect), keys (token refresh) and webhook secret (the tokens
 * arrive by webhook) — all four, or a store could be linked and then not kept working (T61).
 */
function sallaLink(config: { authSecret: string }): SallaLinkConfig | null {
  const env = loadEnv();
  return env.SALLA_APP_ID && env.SALLA_CLIENT_ID && env.SALLA_CLIENT_SECRET && env.SALLA_WEBHOOK_SECRET
    ? { appId: env.SALLA_APP_ID, authSecret: config.authSecret }
    : null;
}
const sallaNotYet = () => errors.notImplemented('Salla stores can be linked once the Tajribah Salla app is registered');

/**
 * API-068 — POST /api/salla/open { token } → { linked, ready, ticket }: the app page inside the Salla
 * dashboard hands over the session token Salla gave it; Salla says which store it is (T61). No session
 * of ours — the merchant may not be signed in to Tajribah in that frame.
 */
export const openSallaAppHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const link = sallaLink(config);
  if (!link) throw sallaNotYet();
  const { token } = await readJson(request, z.object({ token: z.string().min(1).max(4096) }));
  return json(await openSallaApp(token, link));
});

/** The Zid app's settings, or null until it is registered in the Zid Partner dashboard (T61). */
function zidConnect(config: { authSecret: string; appUrl: string }): ZidConnectConfig | null {
  const app = zidApp();
  return app ? { ...app, authSecret: config.authSecret, appUrl: config.appUrl } : null;
}
const zidNotYet = () => errors.notImplemented('Zid stores can be connected once the Tajribah Zid app is registered');

/** The browser's half of Zid's `state`: HttpOnly, only sent back to the Zid routes, ten minutes. */
const stateCookie = (nonce: string, secure: boolean) =>
  `${ZID_STATE_COOKIE}=${nonce}; Path=/api/connections/zid; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
const clearStateCookie = (secure: boolean) => `${ZID_STATE_COOKIE}=; Path=/api/connections/zid; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
const cookieValue = (request: Request, name: string) =>
  (request.headers.get('cookie') ?? '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || null;

/** API-084 — POST /api/connections/zid/start → { authorizeUrl }: a signed-in merchant connects their Zid store. */
export const startZidHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const app = zidConnect(config);
  if (!app) throw zidNotYet();
  const { authorizeUrl, nonce } = await startZidFromDashboard(ctx, app);
  return json({ authorizeUrl }, { headers: { 'set-cookie': stateCookie(nonce, config.secureCookies) } });
});

/** API-085 — GET /api/connections/zid/activate: Zid's "Activate" opens this; OAuth starts at once (Zid's policy). */
export const activateZidHandler = route(async () => {
  const config = apiConfig();
  const app = zidConnect(config);
  if (!app) throw zidNotYet();
  const { authorizeUrl, nonce } = await startZid(app, null);
  return new Response(null, { status: 302, headers: { location: authorizeUrl, 'set-cookie': stateCookie(nonce, config.secureCookies), 'cache-control': 'no-store' } });
});

/** API-086 — GET /api/connections/zid/callback?code&state: exchanged here, at once; back to Store connections. */
export const zidCallbackHandler = route(async (request) => {
  const config = apiConfig();
  const app = zidConnect(config);
  if (!app) throw zidNotYet();
  const next = await completeZidCallback(new URL(request.url).searchParams, cookieValue(request, ZID_STATE_COOKIE), app, { requestId: currentScope()?.requestId });
  return new Response(null, { status: 302, headers: { location: new URL(next, config.appUrl).toString(), 'set-cookie': clearStateCookie(config.secureCookies), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
});

/** API-087 — POST /api/connections/zid/link { ticket }: the signed-in merchant links that Zid store (T61). */
export const linkZidHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const app = zidConnect(config);
  if (!app) throw zidNotYet();
  const { ticket } = await readJson(request, z.object({ ticket: z.string().min(1).max(1024) }));
  return json(await linkZidStore(ctx, ticket, app));
});

/** API-069 — POST /api/connections/salla/link { ticket }: the signed-in merchant links that Salla store (T61). */
export const linkSallaHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const link = sallaLink(config);
  if (!link) throw sallaNotYet();
  const { ticket } = await readJson(request, z.object({ ticket: z.string().min(1).max(1024) }));
  return json(await linkSallaStore(ctx, ticket, link));
});

/** API-066 — POST /api/connections/shopify/start { shop } → { authorizeUrl } (the shop's own install screen). */
export const startShopifyConnectHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const app = shopifyApp(config);
  if (!app) throw shopifyNotYet();
  const { shop } = await readJson(request, z.object({ shop: z.string().max(300) }));
  return json(await startShopifyConnect(ctx, shop, app));
});

/**
 * API-067 — POST /api/connections/shopify/complete { query }: the query Shopify sent the merchant back
 * with, handed over by Store connections with the merchant's own session (see `shopify.ts`).
 */
export const completeShopifyConnectHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const app = shopifyApp(config);
  if (!app) throw shopifyNotYet();
  const { query } = await readJson(request, z.object({ query: z.string().max(4096) }));
  return json(await completeShopifyConnect(ctx, query, app));
});
