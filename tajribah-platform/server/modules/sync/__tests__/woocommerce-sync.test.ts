/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P6 — a WooCommerce store, end to end through the real sync engine and worker: connected with its
 * keys (sealed like any token), synced in full into the Tajribah catalogue — Arabic names, prices in
 * halalas, drafts and hidden products as they are — then an edit in wp-admin arrives on the next
 * incremental sync; and revoked keys ask the merchant to reconnect rather than retrying forever.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { products, storeConnections, type Job } from '@/db/schema';
import { conformanceCatalogue } from '@/server/connectors/conformance';
import { Transport, type Clock } from '@/server/connectors/transport';
import { clearConnectors, registerConnector } from '@/server/connectors/types';
import { WooCommerceConnector, wooToken } from '@/server/connectors/woocommerce/connector';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { clearHandlers, registerHandler, tick } from '@/server/core/jobs/runner';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { WOO_URL, WooStore } from '@/server/testing/woo-store';
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

async function wooMerchant(harness: TestDb, store: WooStore) {
  const seeded = await seedTenant(harness, 'woo', { plan: 'pro' }); // WooCommerce is Pro and up
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r-woo' });
  clearConnectors();
  registerConnector(new WooCommerceConnector(new Transport('woocommerce', { rate: { requests: 100_000, perMs: 1000 } }, store.fetch, instant)));
  const connection = await connectStore(ctx, {
    provider: 'woocommerce', externalStoreId: new URL(WOO_URL).host, storeUrl: WOO_URL,
    tokens: { accessToken: wooToken({ url: WOO_URL, key: 'ck_ok', secret: 'cs_ok' }), scopes: ['read'] },
  });
  return { ...seeded, ctx, connectionId: connection.id };
}

test('a WooCommerce store syncs into the catalogue, and an edit in wp-admin follows', async () => {
  const harness = await createTestDb();
  try {
    const store = new WooStore(conformanceCatalogue());
    const { ctx, tenantId, connectionId } = await wooMerchant(harness, store);
    const [connection] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connectionId))) as any[];
    assert.ok(!JSON.stringify(connection).includes('cs_ok'), 'the key pair is sealed, not stored');

    await requestSync(ctx, connectionId, { type: 'full' });
    await drain();
    const done = await latestSync(ctx, connectionId);
    assert.deepEqual([done?.status, done?.processed, done?.failed], ['done', 250, 0]);

    const rows = await harness.asAdmin(() => harness.db.select().from(products).where(eq(products.tenantId, tenantId))) as any[];
    assert.equal(rows.length, 250);
    const byId = new Map(rows.map((r) => [r.externalId, r]));
    const first = byId.get('1');
    assert.deepEqual([first.name, first.nameAr], ['ساعة ذهبية ✨', 'ساعة ذهبية ✨'], 'the store’s Arabic name');
    assert.equal(byId.get('3').priceMinor, 125_050, 'SAR 1,250.50 in halalas');
    assert.equal(byId.get('4').status, 'draft');
    assert.equal(byId.get('5').status, 'archived', 'a private product is hidden from the shop');

    // The merchant renames a product in wp-admin; the next incremental sync brings it.
    store.change('2', { name: 'منتج معدّل' }, new Date());
    await requestSync(ctx, connectionId, { type: 'incremental' });
    await drain();
    const [renamed] = await harness.asAdmin(() => harness.db.select().from(products).where(eq(products.externalId, '2'))) as any[];
    assert.equal(renamed.name, 'منتج معدّل');
  } finally { clearConnectors(); await harness.close(); }
});

test('keys revoked in WordPress: the sync fails once and the connection asks for a reconnect', async () => {
  const harness = await createTestDb();
  try {
    const store = new WooStore(conformanceCatalogue().slice(0, 5));
    const { ctx, connectionId } = await wooMerchant(harness, store);
    store.revoked.add('ck_ok');
    await requestSync(ctx, connectionId, { type: 'full' });
    await drain();
    const [connection] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connectionId))) as any[];
    assert.notEqual(connection.status, 'active', `the connection is ${connection.status}, not left active to fail every hour`);
    assert.equal((await latestSync(ctx, connectionId))?.status, 'failed');
  } finally { clearConnectors(); await harness.close(); }
});
