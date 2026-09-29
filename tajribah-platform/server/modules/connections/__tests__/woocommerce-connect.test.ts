/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P6 — connecting WooCommerce with its own approval screen: the link we send the merchant to; the
 * callback that saves the connection only when the state is ours and fresh, the merchant may still
 * connect stores on a plan with WooCommerce, and the keys open the very site the state names — then
 * queues the first sync; and a repeated callback is the same connection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { storeConnections, syncJobs, tenantMemberships, planFeatures, plans } from '@/db/schema';
import { Transport, type Clock } from '@/server/connectors/transport';
import { clearConnectors, registerConnector } from '@/server/connectors/types';
import { WooCommerceConnector } from '@/server/connectors/woocommerce/connector';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { WOO_URL, WooStore } from '@/server/testing/woo-store';
import { CONNECT_TTL_MS, completeWooConnect, startWooConnect, wooBase } from '@/server/modules/connections/woocommerce';
import { wooCallbackHandler } from '@/server/modules/connections/http';

setLogLevel('error');
const APP = 'https://app.tajribah.sa';
const SECRET = 's'.repeat(40);
const CONFIG = { authSecret: SECRET, appUrl: APP };
const instant: Clock = { now: () => Date.now(), sleep: async () => {}, random: () => 0 };

async function setup(harness: TestDb, plan: 'pro' | 'starter' = 'pro') {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: SECRET, ENCRYPTION_KEY: 'e'.repeat(40) });
  const store = new WooStore([]);
  const connector = new WooCommerceConnector(new Transport('woocommerce', { rate: { requests: 100_000, perMs: 1000 } }, store.fetch, instant));
  clearConnectors();
  registerConnector(connector);
  const seeded = await seedTenant(harness, 'woo', plan === 'pro' ? { plan: 'pro' } : {});
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  return { ...seeded, ctx, store, connector };
}
const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get('user_id')!;
const approved = (userId: string, key = 'ck_ok', secret = 'cs_ok') => ({ user_id: userId, consumer_key: key.padEnd(12, '_'), consumer_secret: secret.padEnd(12, '_'), key_permissions: 'read' });

test('the approval link: the store’s own page, read access only, our state, our callback over https', async () => {
  const harness = await createTestDb();
  try {
    const off = await setup(harness, 'starter');
    await assert.rejects(() => startWooConnect(off.ctx, WOO_URL, CONFIG), (e: any) => e.code === 'plan_required', 'WooCommerce is Pro and up');
    await harness.close();
  } catch (e) { await harness.close(); throw e; }
  const again = await createTestDb();
  try {
    const a = await setup(again);
    for (const bad of ['http://shop.example.sa', 'https://localhost', 'https://10.0.0.2', 'nonsense']) {
      await assert.rejects(() => startWooConnect(a.ctx, bad, CONFIG), (e: any) => e.code === 'validation_failed', bad);
    }
    const { authorizeUrl } = await startWooConnect(a.ctx, `${WOO_URL}/wp-admin/admin.php?page=wc-settings`, CONFIG);
    const url = new URL(authorizeUrl);
    assert.equal(`${url.origin}${url.pathname}`, `${WOO_URL}/wc-auth/v1/authorize`, 'wp-admin trimmed off');
    assert.deepEqual([url.searchParams.get('app_name'), url.searchParams.get('scope')], ['Tajribah', 'read']);
    assert.equal(url.searchParams.get('callback_url'), `${APP}/api/connections/woocommerce/callback`);
    assert.equal(url.searchParams.get('return_url'), `${APP}/dashboard/connections?woocommerce=returned`);
    assert.equal(wooBase('https://example.sa/shop/'), 'https://example.sa/shop', 'a store in a sub-folder keeps its folder');
  } finally { clearConnectors(); await again.close(); resetEnv(); }
});

test('the callback saves the connection sealed and queues the first sync; again is the same connection', async () => {
  const harness = await createTestDb();
  try {
    const a = await setup(harness);
    const state = stateOf((await startWooConnect(a.ctx, WOO_URL, CONFIG)).authorizeUrl);
    a.store.keys.set('ck_ok_______', 'cs_ok_______');
    const connection = await completeWooConnect(approved(state), CONFIG, 'cb', Date.now(), a.connector);
    assert.equal(connection.provider, 'woocommerce');
    const [row] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connection.id))) as any[];
    assert.deepEqual([row.externalStoreId, row.storeUrl, row.status], ['shop.example.sa', WOO_URL, 'active']);
    assert.ok(!JSON.stringify(row).includes('cs_ok_______'), 'the secret is sealed');
    const syncs = await harness.asAdmin(() => harness.db.select().from(syncJobs).where(eq(syncJobs.connectionId, connection.id))) as any[];
    assert.deepEqual(syncs.map((s) => [s.type, s.status]), [['full', 'queued']], 'the first sync is on its way');

    // WooCommerce calls back again with the same state (a retry): the same connection, its keys replaced.
    const again = await completeWooConnect(approved(state), CONFIG, 'cb2', Date.now(), a.connector);
    assert.equal(again.id, connection.id);
    assert.equal((await harness.asAdmin(() => harness.db.select().from(storeConnections))).length, 1);

    // And through the real endpoint, as WooCommerce's server would send it.
    const response = await wooCallbackHandler(new Request(`${APP}/api/connections/woocommerce/callback`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...approved(state), key_id: 7 }),
    }));
    assert.equal(response.status, 200);
  } finally { clearConnectors(); await harness.close(); resetEnv(); }
});

test('refused: a forged or expired state, keys that do not open that store, too little access', async () => {
  const harness = await createTestDb();
  try {
    const a = await setup(harness);
    a.store.keys.set('ck_ok_______', 'cs_ok_______');
    const state = stateOf((await startWooConnect(a.ctx, WOO_URL, CONFIG)).authorizeUrl);
    const forbidden = (e: any) => e.code === 'forbidden';
    const [payload, mac] = state.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), t: '01a0f000-0000-7000-8000-00000000dead' })).toString('base64url')}.${mac}`;
    await assert.rejects(() => completeWooConnect(approved(forged), CONFIG, 'cb', Date.now(), a.connector), forbidden, 'another store’s id in the state');
    await assert.rejects(() => completeWooConnect(approved('nonsense'), CONFIG, 'cb', Date.now(), a.connector), forbidden);
    await assert.rejects(() => completeWooConnect(approved(state), CONFIG, 'cb', Date.now() + CONNECT_TTL_MS + 1000, a.connector), forbidden, 'expired');
    await assert.rejects(() => completeWooConnect(approved(state, 'ck_wrong', 'cs_wrong'), CONFIG, 'cb', Date.now(), a.connector), (e: any) => e.code === 'validation_failed', 'keys the store does not accept');
    await assert.rejects(() => completeWooConnect({ ...approved(state), key_permissions: 'write' }, CONFIG, 'cb', Date.now(), a.connector), (e: any) => e.code === 'validation_failed');

    // Real keys, but the state names another site: they are tested there, and do not open it.
    const other = stateOf((await startWooConnect(a.ctx, 'https://other.example.sa', CONFIG)).authorizeUrl);
    await assert.rejects(() => completeWooConnect(approved(other), CONFIG, 'cb', Date.now(), a.connector), (e: any) => e.code === 'validation_failed');
    assert.equal((await harness.asAdmin(() => harness.db.select().from(storeConnections))).length, 0, 'nothing saved');
  } finally { clearConnectors(); await harness.close(); resetEnv(); }
});

test('the merchant is checked as they are at the callback: no longer allowed, or no longer on the plan', async () => {
  const harness = await createTestDb();
  try {
    const a = await setup(harness);
    a.store.keys.set('ck_ok_______', 'cs_ok_______');
    const state = stateOf((await startWooConnect(a.ctx, WOO_URL, CONFIG)).authorizeUrl);
    await harness.asAdmin(() => harness.db.update(tenantMemberships).set({ role: 'viewer' } as any).where(eq(tenantMemberships.userId, a.userId)));
    await assert.rejects(() => completeWooConnect(approved(state), CONFIG, 'cb', Date.now(), a.connector), (e: any) => e.code === 'forbidden', 'demoted meanwhile');
    await harness.asAdmin(() => harness.db.update(tenantMemberships).set({ role: 'owner' } as any).where(eq(tenantMemberships.userId, a.userId)));
    const [pro] = await harness.asAdmin(() => harness.db.select().from(plans).where(eq(plans.code, 'pro'))) as any[];
    await harness.asAdmin(() => harness.db.delete(planFeatures).where(eq(planFeatures.planId, pro.id)));
    await assert.rejects(() => completeWooConnect(approved(state), CONFIG, 'cb', Date.now(), a.connector), (e: any) => e.code === 'plan_required', 'the plan changed meanwhile');
  } finally { clearConnectors(); await harness.close(); resetEnv(); }
});
