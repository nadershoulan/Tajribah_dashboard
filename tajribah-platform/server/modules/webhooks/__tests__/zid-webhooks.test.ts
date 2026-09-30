/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T61 — Zid's product webhooks through the real endpoint and dispatcher. Zid signs nothing; it sends
 * back the Basic-auth credentials each subscription was given — the store and event as the username,
 * our keyed hash of it as the password. Only those exact credentials are believed; a change queues a
 * catch-up, a deletion archives, a redelivery is stored once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { products, syncJobs, webhookEvents } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { zidToken } from '@/server/connectors/zid/connector';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { connectStore } from '@/server/modules/connections/service';
import { zidWebhookPassword } from '@/server/modules/connections/zid';
import { dispatchPending } from '@/server/modules/webhooks/dispatch';
import { receiveWebhookHandler } from '@/server/modules/webhooks/http';
import { clearWebhookSources, registerWebhookSource } from '@/server/modules/webhooks/sources';
import { ZID_TOPICS, zidSource } from '@/server/modules/webhooks/zid';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

const SECRET = 'zid_app_secret';
const STORE = '3';
const PRODUCT = 'a497974d-1755-423a-b06c-e0578ba8c318';
clearWebhookSources();
registerWebhookSource(zidSource(SECRET));

const basic = (username: string, password: string) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
async function deliver(event: string, body: unknown, options: { store?: string; password?: string; header?: string | null } = {}) {
  const username = `${options.store ?? STORE}.${event}`;
  const header = options.header === undefined ? basic(username, options.password ?? await zidWebhookPassword(SECRET, username)) : options.header;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (header !== null) headers.authorization = header;
  const response = await receiveWebhookHandler(new Request('http://localhost:5173/api/webhooks/zid', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() as any };
}

async function store(harness: TestDb) {
  const seeded = await seedTenant(harness, 'oud', { plan: 'pro' });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const connection = await connectStore(ctx, { provider: 'zid', externalStoreId: STORE, tokens: { accessToken: zidToken({ authorization: 'a', manager: 'm', storeId: STORE }), refreshToken: 'r' } });
  return { ...seeded, connectionId: connection.id };
}
const rows = (harness: TestDb, table: any): Promise<any[]> => harness.asAdmin(() => harness.db.select().from(table) as any);

test('only the credentials we gave that store for that event are believed', async () => {
  const harness = await createTestDb();
  try {
    await store(harness);
    const product = { id: PRODUCT, updated_at: '2026-09-30T10:00:00.000000Z', name: { ar: 'سماعة', en: 'Headphones' } };
    assert.equal((await deliver('product.update', product)).status, 202);
    assert.equal((await deliver('product.update', product, { password: 'guessed' })).status, 401);
    assert.equal((await deliver('product.update', product, { header: null })).status, 401);
    assert.equal((await deliver('product.update', product, { header: 'Bearer something' })).status, 401);
    // Store 3's password for product.update does not speak for store 4, nor for another event.
    const three = await zidWebhookPassword(SECRET, `${STORE}.product.update`);
    assert.equal((await deliver('product.update', product, { store: '4', password: three })).status, 401);
    assert.equal((await deliver('product.delete', product, { password: three })).status, 401);
    assert.equal((await deliver('order.create', product)).status, 401, 'an event we never subscribed to');
    assert.equal((await rows(harness, webhookEvents)).length, 1, 'refused deliveries leave no row');

    // A store nobody here has connected: 200, dropped. Zid retrying the same delivery: stored once.
    assert.equal((await deliver('product.update', product, { store: '99' })).body.outcome, 'unknown_store');
    assert.equal((await deliver('product.update', product)).body.outcome, 'duplicate');
    assert.equal((await deliver('product.update', { ...product, updated_at: '2026-09-30T10:05:00.000000Z' })).body.outcome, 'accepted', 'a later change is a new delivery');
  } finally { await harness.close(); }
});

test('a change catches up at once, publishing is a change, a deletion archives', async () => {
  const harness = await createTestDb();
  try {
    const { tenantId, connectionId } = await store(harness);
    const productId = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: productId, tenantId, connectionId, externalId: PRODUCT, name: 'Headphones', status: 'active' } as any));
    assert.deepEqual(ZID_TOPICS, { 'product.create': 'product.created', 'product.update': 'product.updated', 'product.publish': 'product.updated', 'product.delete': 'product.deleted' });

    await deliver('product.publish', { id: PRODUCT, updated_at: '2026-09-30T11:00:00Z' });
    await dispatchPending();
    assert.deepEqual((await rows(harness, syncJobs)).map((s) => [s.type, s.triggeredBy]), [['full', 'webhook']]);

    await deliver('product.delete', { id: PRODUCT });
    await dispatchPending();
    const [archived] = await harness.asAdmin(() => harness.db.select().from(products).where(eq(products.id, productId))) as any[];
    assert.equal(archived.status, 'archived');
    const handled = await rows(harness, webhookEvents);
    assert.ok(handled.every((e) => e.status === 'processed'), JSON.stringify(handled.map((e) => [e.topic, e.status])));
  } finally { await harness.close(); }
});
