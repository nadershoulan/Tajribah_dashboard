/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P6 — Shopify's webhooks through the real endpoint and dispatcher: the signature (base64 HMAC of the
 * raw body with the app secret, computed here with node:crypto) or 401 and nothing stored; a product
 * change queues a catch-up sync; a deletion archives the product; an uninstall revokes the connection
 * and erases its token; the privacy topics — nothing held about customers, and a shop's erasure
 * erases its access; a redelivery once; a shop we do not know answered 200 and dropped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { products, storeConnections, syncJobs, webhookEvents } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { clearConnectors } from '@/server/connectors/types';
import { shopifyToken } from '@/server/connectors/shopify/connector';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { connectStore } from '@/server/modules/connections/service';
import { dispatchPending } from '@/server/modules/webhooks/dispatch';
import { receiveWebhookHandler } from '@/server/modules/webhooks/http';
import { clearWebhookSources, registerWebhookSource } from '@/server/modules/webhooks/sources';
import { SHOPIFY_TOPICS, shopifySource } from '@/server/modules/webhooks/shopify';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

const SECRET = 'shpss_app_secret';
const SHOP = 'oud-house.myshopify.com';
clearWebhookSources();
registerWebhookSource(shopifySource(SECRET));

async function deliver(topic: string, body: unknown, options: { secret?: string; shop?: string; eventId?: string; hmac?: string | null } = {}) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json', 'x-shopify-topic': topic, 'x-shopify-shop-domain': options.shop ?? SHOP,
    'x-shopify-event-id': options.eventId ?? uuidv7(), 'x-shopify-webhook-id': uuidv7(), 'x-shopify-api-version': '2026-07',
  };
  const hmac = options.hmac === undefined ? createHmac('sha256', options.secret ?? SECRET).update(raw).digest('base64') : options.hmac;
  if (hmac !== null) headers['x-shopify-hmac-sha256'] = hmac;
  const response = await receiveWebhookHandler(new Request('http://localhost:5173/api/webhooks/shopify', { method: 'POST', headers, body: raw }));
  return { status: response.status, body: await response.json() as any };
}

async function shop(harness: TestDb) {
  const seeded = await seedTenant(harness, 'oud', { plan: 'pro' });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const connection = await connectStore(ctx, { provider: 'shopify', externalStoreId: SHOP, storeUrl: `https://${SHOP}`, tokens: { accessToken: shopifyToken({ shop: SHOP, token: 'shpat_x' }) } });
  return { ...seeded, ctx, connectionId: connection.id };
}
const rows = (harness: TestDb, table: any): Promise<any[]> => harness.asAdmin(() => harness.db.select().from(table) as any);

test('only Shopify’s signature over the exact bytes is believed', async () => {
  const harness = await createTestDb();
  try {
    await shop(harness);
    assert.equal((await deliver('products/update', { id: 1, title: 'x' })).status, 202);
    assert.equal((await deliver('products/update', { id: 1 }, { secret: 'another-secret' })).status, 401);
    assert.equal((await deliver('products/update', { id: 1 }, { hmac: null })).status, 401);
    assert.equal((await deliver('products/update', { id: 1 }, { hmac: 'not base64 at all' })).status, 401);
    const hex = createHmac('sha256', SECRET).update(JSON.stringify({ id: 1 })).digest('hex');
    assert.equal((await deliver('products/update', { id: 1 }, { hmac: hex })).status, 401, 'hex is another scheme (Salla’s), not Shopify’s');
    assert.equal((await rows(harness, webhookEvents)).length, 1, 'refused deliveries leave no row');

    // Signed, but naming something that is not a Shopify shop: not an envelope we understand.
    assert.equal((await deliver('products/update', { id: 1 }, { shop: 'evil.example.com' })).status, 422);
    // A delivery for a shop no store here has connected: answered 200, dropped.
    const stranger = await deliver('products/update', { id: 1 }, { shop: 'stranger.myshopify.com' });
    assert.deepEqual([stranger.status, stranger.body.outcome], [200, 'unknown_store']);
    // The same event again (Shopify retrying): stored once.
    const eventId = uuidv7();
    assert.equal((await deliver('products/update', { id: 2 }, { eventId })).body.outcome, 'accepted');
    assert.deepEqual([(await deliver('products/update', { id: 2 }, { eventId })).status, (await deliver('products/update', { id: 2 }, { eventId })).body.outcome], [200, 'duplicate']);
  } finally { await harness.close(); }
});

test('changes, a deletion and an uninstall, as they happen', async () => {
  const harness = await createTestDb();
  try {
    const { tenantId, connectionId } = await shop(harness);
    const productId = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: productId, tenantId, connectionId, externalId: '1007', name: 'Oud 41', status: 'active' } as any));

    await deliver('products/update', { id: 1007, title: 'Oud 41', updated_at: '2026-09-30T10:00:00+03:00' });
    await dispatchPending();
    const syncs = await rows(harness, syncJobs);
    // Queued by the webhook at once (full here: the shop has never been synced, so there is nothing to catch up from).
    assert.deepEqual(syncs.map((s) => [s.type, s.triggeredBy]), [['full', 'webhook']], 'a change catches up at once');

    await deliver('products/delete', { id: 1007 });
    await dispatchPending();
    const [archived] = await harness.asAdmin(() => harness.db.select().from(products).where(eq(products.id, productId))) as any[];
    assert.equal(archived.status, 'archived', 'a deletion archives it (a sync never sees deletions)');

    await deliver('app/uninstalled', { id: 548380009, name: 'Oud House', domain: SHOP });
    await dispatchPending();
    const [connection] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connectionId))) as any[];
    assert.equal(connection.status, 'revoked');
    assert.equal(connection.accessTokenEncrypted, null, 'the token is erased at once');

    const handled = await rows(harness, webhookEvents);
    assert.ok(handled.every((e) => e.status === 'processed'), JSON.stringify(handled.map((e) => [e.topic, e.status])));
  } finally { await harness.close(); }
});

test('the privacy topics Shopify requires: nothing about customers is held; a shop’s erasure erases its access', async () => {
  const harness = await createTestDb();
  try {
    const { connectionId } = await shop(harness);
    const customer = { shop_id: 954889, shop_domain: SHOP, customer: { id: 191167, email: 'john@example.com', phone: '555-625-1199' }, orders_to_redact: [299938] };
    assert.equal((await deliver('customers/data_request', { ...customer, orders_requested: [299938], data_request: { id: 9999 } })).status, 202);
    assert.equal((await deliver('customers/redact', customer)).status, 202);
    await dispatchPending();
    const [still] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connectionId))) as any[];
    assert.equal(still.status, 'active', 'a customer’s request does not touch the shop’s connection');

    assert.equal((await deliver('shop/redact', { shop_id: 954889, shop_domain: SHOP })).status, 202);
    await dispatchPending();
    const [erased] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connectionId))) as any[];
    assert.deepEqual([erased.status, erased.accessTokenEncrypted, erased.refreshTokenEncrypted], ['revoked', null, null]);

    const events = await rows(harness, webhookEvents);
    assert.deepEqual(events.map((e) => [e.topic, e.status]).sort(), [
      ['privacy.customer_data_request', 'processed'], ['privacy.customer_redact', 'processed'], ['privacy.shop_redact', 'processed'],
    ]);
    // The customer's details arrived in the body; nothing is kept beyond the delivery record Shopify sent.
    assert.deepEqual(Object.values(SHOPIFY_TOPICS).filter((t) => t.startsWith('privacy.')).length, 3);
  } finally { clearConnectors(); await harness.close(); }
});
