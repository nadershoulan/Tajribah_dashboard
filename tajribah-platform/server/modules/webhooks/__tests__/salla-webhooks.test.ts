/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T61 — Salla's webhooks through the real endpoint and dispatcher: the signature (hex HMAC of the raw
 * body with the webhook secret, computed here with node:crypto) or 401 and nothing stored; every kind
 * of product change queues a catch-up; a deletion archives; an uninstall revokes and erases the token;
 * a redelivery once (Salla sends no event id); a store we do not know dropped; and the tokens inside
 * `app.store.authorize` never reach the events table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { products, storeConnections, syncJobs, webhookEvents } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { connectStore } from '@/server/modules/connections/service';
import { dispatchPending } from '@/server/modules/webhooks/dispatch';
import { receiveWebhookHandler } from '@/server/modules/webhooks/http';
import { clearWebhookSources, registerWebhookSource } from '@/server/modules/webhooks/sources';
import { SALLA_PRODUCT_CHANGES, sallaSource, sallaTopic } from '@/server/modules/webhooks/salla';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

const SECRET = 'salla_webhook_secret';
const MERCHANT = 1305146709;
clearWebhookSources();
registerWebhookSource(sallaSource(SECRET));

let second = 0;
/** Salla's envelope, stamped as Salla stamps product events. */
const envelope = (event: string, data: Record<string, unknown>, merchant: number | string = MERCHANT) =>
  ({ event, merchant, created_at: `Mon Apr 17 2023 12:14:${String(second++ % 60).padStart(2, '0')} GMT+0300`, data });

async function deliver(body: unknown, options: { secret?: string; signature?: string | null } = {}) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-salla-security-strategy': 'Signature' };
  const signature = options.signature === undefined ? createHmac('sha256', options.secret ?? SECRET).update(raw).digest('hex') : options.signature;
  if (signature !== null) headers['x-salla-signature'] = signature;
  const response = await receiveWebhookHandler(new Request('http://localhost:5173/api/webhooks/salla', { method: 'POST', headers, body: raw }));
  return { status: response.status, body: await response.json() as any };
}

async function store(harness: TestDb) {
  const seeded = await seedTenant(harness, 'oud', { plan: 'pro' });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const connection = await connectStore(ctx, { provider: 'salla', externalStoreId: String(MERCHANT), storeUrl: 'https://oud-house.example.sa', tokens: { accessToken: 'salla_at_x', refreshToken: 'salla_rt_x' } });
  return { ...seeded, ctx, connectionId: connection.id };
}
const rows = (harness: TestDb, table: any): Promise<any[]> => harness.asAdmin(() => harness.db.select().from(table) as any);

test('only Salla’s signature over the exact bytes is believed', async () => {
  const harness = await createTestDb();
  try {
    await store(harness);
    const body = envelope('product.price.updated', { id: 1025569331 });
    assert.equal((await deliver(body)).status, 202);
    assert.equal((await deliver(envelope('product.created', { id: 1 }), { secret: 'another-secret' })).status, 401);
    assert.equal((await deliver(envelope('product.created', { id: 1 }), { signature: null })).status, 401);
    assert.equal((await deliver(envelope('product.created', { id: 1 }), { signature: 'x'.repeat(64) })).status, 401);
    const base64 = createHmac('sha256', SECRET).update(JSON.stringify(envelope('product.created', { id: 1 }))).digest('base64');
    assert.equal((await deliver(envelope('product.created', { id: 1 }), { signature: base64 })).status, 401, 'base64 is another scheme (Shopify’s), not Salla’s');
    assert.equal((await rows(harness, webhookEvents)).length, 1, 'refused deliveries leave no row');

    // Signed, but with no store in it, or not a Salla store id: not an envelope we understand.
    assert.equal((await deliver({ event: 'product.created', data: { id: 1 } })).status, 422);
    assert.equal((await deliver(envelope('product.created', { id: 1 }, 'oud-house'))).status, 422);
    // A store nobody here has connected: answered 200, dropped.
    const stranger = await deliver(envelope('product.created', { id: 1 }, 42));
    assert.deepEqual([stranger.status, stranger.body.outcome], [200, 'unknown_store']);
    // Salla retrying the same delivery: stored once.
    assert.deepEqual([(await deliver(body)).status, (await deliver(body)).body.outcome], [200, 'duplicate']);
    // The same kind of change to the same product, stamped later, is a new delivery — not a retry.
    assert.equal((await deliver({ ...body, created_at: 'Mon Apr 17 2023 12:20:00 GMT+0300' })).body.outcome, 'accepted');
  } finally { await harness.close(); }
});

test('every kind of product change, a deletion and an uninstall, as they happen', async () => {
  const harness = await createTestDb();
  try {
    const { tenantId, connectionId } = await store(harness);
    const productId = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: productId, tenantId, connectionId, externalId: '1025569331', name: 'Oud 41', status: 'active' } as any));

    for (const event of SALLA_PRODUCT_CHANGES) assert.equal(sallaTopic(event), 'product.updated', event);
    for (const event of ['product.created', 'product.deleted', 'app.uninstalled']) assert.equal(sallaTopic(event), event);
    // The subject is a product, and only for product events (an uninstall's data.id is the app's).
    const parse = (body: unknown) => sallaSource(SECRET).parse(body)?.subject;
    assert.equal(parse(envelope('app.uninstalled', { id: 6789012345 })), null);
    assert.equal(parse(envelope('product.created', { id: 'not-a-number' })), null);
    assert.equal(parse(envelope('product.created', { id: '1025569331' })), '1025569331');
    assert.equal(sallaTopic('order.created'), 'order.created', 'anything else keeps Salla’s own name, and is ignored');

    await deliver(envelope('product.status.updated', { id: 1025569331, status: 'sale' }));
    await dispatchPending();
    assert.deepEqual((await rows(harness, syncJobs)).map((s) => [s.type, s.triggeredBy]), [['full', 'webhook']], 'a change catches up at once');

    await deliver(envelope('product.deleted', { id: 1025569331 }));
    await dispatchPending();
    const [archived] = await harness.asAdmin(() => harness.db.select().from(products).where(eq(products.id, productId))) as any[];
    assert.equal(archived.status, 'archived', 'a deletion archives it');

    await deliver({ event: 'app.uninstalled', merchant: MERCHANT, created_at: '2022-12-31 12:31:25', data: { id: 6789012345, app_name: 'Tajribah', refunded: false, store_type: 'live' } });
    await dispatchPending();
    const [connection] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connectionId))) as any[];
    assert.deepEqual([connection.status, connection.accessTokenEncrypted, connection.refreshTokenEncrypted], ['revoked', null, null], 'the tokens are erased at once');

    const handled = await rows(harness, webhookEvents);
    assert.ok(handled.every((e) => e.status === 'processed'), JSON.stringify(handled.map((e) => [e.topic, e.status])));
  } finally { await harness.close(); }
});

test('the tokens inside app.store.authorize are never written to the events table', async () => {
  const harness = await createTestDb();
  try {
    await store(harness);
    const authorize = {
      event: 'app.store.authorize', merchant: MERCHANT, created_at: '2022-12-31 12:31:25',
      data: { access_token: 'ory_at_live_secret', expires: 1634819484, refresh_token: 'ory_rt_live_secret', scope: 'settings.read products.read offline_access', token_type: 'bearer' },
    };
    assert.equal((await deliver(authorize)).status, 202);
    const [row] = await rows(harness, webhookEvents);
    const stored = JSON.stringify(row.payload);
    assert.ok(!stored.includes('ory_at_live_secret') && !stored.includes('ory_rt_live_secret'), stored);
    assert.deepEqual([row.payload.data.access_token, row.payload.data.scope], ['[redacted]', 'settings.read products.read offline_access']);
  } finally { await harness.close(); }
});
