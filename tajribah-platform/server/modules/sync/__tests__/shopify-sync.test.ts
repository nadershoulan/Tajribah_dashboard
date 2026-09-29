/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P6 — a Shopify store, end to end through the real sync engine and worker: connected with its
 * offline token (sealed like any token), synced in full into the Tajribah catalogue — Arabic titles,
 * prices in halalas, drafts and archived products as they are — then an edit in the Shopify admin
 * arrives on the next incremental sync; and an uninstalled app asks the merchant to reconnect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { products, storeConnections, type Job } from '@/db/schema';
import { conformanceCatalogue } from '@/server/connectors/conformance';
import { Transport, type Clock } from '@/server/connectors/transport';
import { clearConnectors, registerConnector } from '@/server/connectors/types';
import { ShopifyConnector, shopifyToken } from '@/server/connectors/shopify/connector';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { clearHandlers, registerHandler, tick } from '@/server/core/jobs/runner';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { SHOPIFY_SHOP, ShopifyStore } from '@/server/testing/shopify-store';
import { connectStore } from '@/server/modules/connections/service';
import { handleSyncJob } from '@/server/modules/sync/job';
import { latestSync, requestSync } from '@/server/modules/sync/service';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

const instant: Clock = { now: () => Date.now(), sleep: async () => {}, random: () => 0 };

async function drain(): Promise<void> {
  clearHandlers();
  registerHandler('sync.products', (job: Job) => handleSyncJob(job));
  while ((await tick('test-worker', 10)).claimed > 0) { /* until the queue is empty */ }
}

async function shopifyMerchant(harness: TestDb, store: ShopifyStore) {
  const seeded = await seedTenant(harness, 'shop', { plan: 'pro' }); // Shopify is Pro and up
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r-shop' });
  clearConnectors();
  registerConnector(new ShopifyConnector(new Transport('shopify', { rate: { requests: 100_000, perMs: 1000 } }, store.fetch, instant), async () => {}));
  const connection = await connectStore(ctx, {
    provider: 'shopify', externalStoreId: SHOPIFY_SHOP, storeUrl: `https://${SHOPIFY_SHOP}`,
    tokens: { accessToken: shopifyToken({ shop: SHOPIFY_SHOP, token: 'shpat_ok' }), scopes: ['read_products'] },
  });
  return { ...seeded, ctx, connectionId: connection.id };
}

test('a Shopify store syncs into the catalogue, and an edit in the Shopify admin follows', async () => {
  const harness = await createTestDb();
  try {
    const store = new ShopifyStore(conformanceCatalogue());
    const { ctx, tenantId, connectionId } = await shopifyMerchant(harness, store);
    const [connection] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connectionId))) as any[];
    assert.ok(!JSON.stringify(connection).includes('shpat_ok'), 'the token is sealed, not stored');

    await requestSync(ctx, connectionId, { type: 'full' });
    await drain();
    const done = await latestSync(ctx, connectionId);
    assert.deepEqual([done?.status, done?.processed, done?.failed], ['done', 250, 0]);

    const rows = await harness.asAdmin(() => harness.db.select().from(products).where(eq(products.tenantId, tenantId))) as any[];
    assert.equal(rows.length, 250);
    const byId = new Map(rows.map((r) => [r.externalId, r]));
    assert.deepEqual([byId.get('1000').name, byId.get('1000').nameAr], ['ساعة ذهبية ✨', 'ساعة ذهبية ✨'], 'the store’s Arabic title');
    assert.equal(byId.get('1002').priceMinor, 125_050, 'SAR 1,250.50 in halalas');
    assert.equal(byId.get('1003').status, 'draft');
    assert.equal(byId.get('1004').status, 'archived');

    store.change('1001', { name: 'منتج معدّل' }, new Date());
    await requestSync(ctx, connectionId, { type: 'incremental' });
    await drain();
    const [renamed] = await harness.asAdmin(() => harness.db.select().from(products).where(eq(products.externalId, '1001'))) as any[];
    assert.equal(renamed.name, 'منتج معدّل');
    assert.ok(store.operations.filter((o) => o === 'ProductsFirst').length >= 2, 'the incremental sync asked Shopify for changes only');
  } finally { clearConnectors(); await harness.close(); }
});

test('an uninstalled app: the sync stops and the connection asks for a reconnect', async () => {
  const harness = await createTestDb();
  try {
    const store = new ShopifyStore(conformanceCatalogue().slice(0, 10));
    const { ctx, connectionId } = await shopifyMerchant(harness, store);
    store.tokens.clear(); // the merchant uninstalled the app
    await requestSync(ctx, connectionId, { type: 'full' });
    await drain();
    const [connection] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connectionId))) as any[];
    assert.equal(connection.status, 'revoked');
  } finally { clearConnectors(); await harness.close(); }
});
