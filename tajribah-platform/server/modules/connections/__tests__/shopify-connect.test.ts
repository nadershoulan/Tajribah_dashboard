/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P6 — connecting a Shopify shop through Shopify's install screen: the link we send the merchant to;
 * the return, which connects only when Shopify's HMAC verifies with our app secret, the state is ours,
 * fresh and for this very person, store and shop, and the one-time code yields a token that can read
 * products and opens that shop — then the first sync is queued. The HMAC here is computed with
 * node:crypto, independently of the code under test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { storeConnections, syncJobs, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { Transport, type Clock } from '@/server/connectors/transport';
import { clearConnectors, registerConnector } from '@/server/connectors/types';
import { ShopifyConnector } from '@/server/connectors/shopify/connector';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { SHOPIFY_APP, SHOPIFY_SHOP, ShopifyStore } from '@/server/testing/shopify-store';
import { CONNECT_TTL_MS, completeShopifyConnect, shopDomain, shopifyHmacValid, startShopifyConnect } from '@/server/modules/connections/shopify';

setLogLevel('error');
const APP = 'https://app.tajribah.sa';
const SECRET = 's'.repeat(40);
const CONFIG = { ...SHOPIFY_APP, authSecret: SECRET, appUrl: APP };
const instant: Clock = { now: () => Date.now(), sleep: async () => {}, random: () => 0 };

async function setup(harness: TestDb, plan: 'pro' | 'growth' = 'pro') {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: SECRET, ENCRYPTION_KEY: 'e'.repeat(40) });
  const store = new ShopifyStore([]);
  const transport = new Transport('shopify', { rate: { requests: 100_000, perMs: 1000 } }, store.fetch, instant);
  const connector = new ShopifyConnector(transport, async () => {});
  clearConnectors();
  registerConnector(connector);
  const seeded = await seedTenant(harness, 'shop', { plan });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  return { ...seeded, ctx, store, deps: { transport, connector } };
}

/** The query Shopify sends the merchant back with, signed as Shopify signs it. */
function shopifyReturn(fields: Record<string, string>, secret = SHOPIFY_APP.clientSecret): string {
  const message = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('&');
  const hmac = createHmac('sha256', secret).update(message).digest('hex');
  return `?${new URLSearchParams({ ...fields, hmac }).toString()}`;
}
const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get('state')!;
const returnFor = (state: string, code: string, shop = SHOPIFY_SHOP) =>
  shopifyReturn({ code, host: Buffer.from(`${shop}/admin`).toString('base64'), shop, state, timestamp: String(Math.floor(Date.now() / 1000)) });

test('the shop name, however it is typed; nothing that is not a myshopify.com shop', () => {
  for (const [typed, shop] of [['oud-house', 'oud-house.myshopify.com'], ['Oud-House.myshopify.com', 'oud-house.myshopify.com'], ['https://oud-house.myshopify.com/admin/products', 'oud-house.myshopify.com'], ['  oud-house  ', 'oud-house.myshopify.com']]) {
    assert.equal(shopDomain(typed), shop, typed);
  }
  for (const bad of ['evil.com', 'https://oud-house.myshopify.com.evil.com', 'a b', '', '-x', 'https://evil.com/?shop=oud-house.myshopify.com']) {
    assert.throws(() => shopDomain(bad), (e: any) => e.code === 'validation_failed', bad);
  }
});

test('Shopify’s signature on the return: sorted fields, hex, the app secret — and nothing else', async () => {
  const good = new URLSearchParams(shopifyReturn({ shop: SHOPIFY_SHOP, code: 'c1', state: 'x', timestamp: '1' }).slice(1));
  assert.equal(await shopifyHmacValid(good, SHOPIFY_APP.clientSecret), true);
  assert.equal(await shopifyHmacValid(good, 'another-secret'), false);
  const swapped = new URLSearchParams(good); swapped.set('shop', 'attacker.myshopify.com');
  assert.equal(await shopifyHmacValid(swapped, SHOPIFY_APP.clientSecret), false, 'a field changed after signing');
  const none = new URLSearchParams(good); none.delete('hmac');
  assert.equal(await shopifyHmacValid(none, SHOPIFY_APP.clientSecret), false);
});

test('the install link: that shop’s own screen, read_products only, our state, back to Store connections', async () => {
  const harness = await createTestDb();
  try {
    const low = await setup(harness, 'growth');
    await assert.rejects(() => startShopifyConnect(low.ctx, 'oud-house', CONFIG), (e: any) => e.code === 'plan_required', 'Shopify is Pro and up');
  } finally { clearConnectors(); await harness.close(); }
  const again = await createTestDb();
  try {
    const a = await setup(again);
    const url = new URL((await startShopifyConnect(a.ctx, 'oud-house', CONFIG)).authorizeUrl);
    assert.equal(`${url.origin}${url.pathname}`, `https://${SHOPIFY_SHOP}/admin/oauth/authorize`);
    assert.deepEqual([url.searchParams.get('client_id'), url.searchParams.get('scope'), url.searchParams.get('redirect_uri')], [SHOPIFY_APP.clientId, 'read_products', `${APP}/dashboard/connections`]);
    assert.ok(url.searchParams.get('state')!.includes('.'), 'a signed state');
    assert.equal(url.searchParams.get('grant_options[]'), null, 'offline access: the shop’s token, not the person’s');
  } finally { clearConnectors(); await again.close(); resetEnv(); }
});

test('the return connects the shop, sealed, and queues the first sync; the code works once', async () => {
  const harness = await createTestDb();
  try {
    const a = await setup(harness);
    const state = stateOf((await startShopifyConnect(a.ctx, 'oud-house', CONFIG)).authorizeUrl);
    a.store.codes.set('code-1', { token: 'shpat_new_1', scope: 'read_products' });
    const connection = await completeShopifyConnect(a.ctx, returnFor(state, 'code-1'), CONFIG, Date.now(), a.deps);
    assert.deepEqual([connection.provider, connection.status], ['shopify', 'active']);
    const [row] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connection.id))) as any[];
    assert.equal(row.externalStoreId, SHOPIFY_SHOP);
    assert.ok(!JSON.stringify(row).includes('shpat_new_1'), 'the token is sealed');
    const syncs = await harness.asAdmin(() => harness.db.select().from(syncJobs).where(eq(syncJobs.connectionId, connection.id)));
    assert.equal(syncs.length, 1, 'the first sync is queued');

    // The same return again: Shopify refuses the used code, and so do we.
    await assert.rejects(() => completeShopifyConnect(a.ctx, returnFor(state, 'code-1'), CONFIG, Date.now(), a.deps), (e: any) => e.code === 'forbidden');
  } finally { clearConnectors(); await harness.close(); resetEnv(); }
});

test('a return that is not what we sent is refused, and nothing is saved', async () => {
  const harness = await createTestDb();
  try {
    const a = await setup(harness);
    const state = stateOf((await startShopifyConnect(a.ctx, 'oud-house', CONFIG)).authorizeUrl);
    const refuse = async (query: string, what: string, code = 'forbidden', ctx = a.ctx, now = Date.now()) =>
      assert.rejects(() => completeShopifyConnect(ctx, query, CONFIG, now, a.deps), (e: any) => e.code === code, what);
    a.store.codes.set('c', { token: 'shpat_c', scope: 'read_products' });

    await refuse(shopifyReturn({ code: 'c', shop: SHOPIFY_SHOP, state, timestamp: '1' }, 'not-our-secret'), 'signed with another secret');
    const forged = new URLSearchParams(returnFor(state, 'c').slice(1)); forged.set('code', 'other');
    await refuse(`?${forged}`, 'a field changed after Shopify signed');
    await refuse(returnFor(state.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')), 'c'), 'a state we did not sign');
    await refuse(returnFor(state, 'c'), 'the state has expired', 'forbidden', a.ctx, Date.now() + CONNECT_TTL_MS + 1000);
    // A valid state, but a real, signed return from another shop — say, one an attacker owns: its code
    // would work, and would attach a shop the merchant never named.
    a.store.shops.add('someone-else.myshopify.com');
    a.store.codes.set('theirs', { token: 'shpat_theirs', scope: 'read_products' });
    await refuse(returnFor(state, 'theirs', 'someone-else.myshopify.com'), 'another shop');

    // The same person, in another of their stores: the state was for this store only.
    const second = await seedTenant(harness, 'second-shop', { plan: 'pro' });
    await harness.asAdmin(() => harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: second.tenantId, userId: a.userId, role: 'owner', status: 'active' } as any));
    const elsewhere = await buildTenantContext({ actor: { userId: a.userId, email: a.email, isStaff: false }, tenantId: second.tenantId, requestId: 'r3' });
    await refuse(returnFor(state, 'c'), 'another store of the same person', 'forbidden', elsewhere);

    // Another person of the same store cannot finish what this one started.
    const otherId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: otherId, email: 'colleague@example.test', passwordHash: 'x', fullName: 'Colleague' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: a.tenantId, userId: otherId, role: 'admin', status: 'active' } as any);
    });
    const colleague = await buildTenantContext({ actor: { userId: otherId, email: 'colleague@example.test', isStaff: false }, tenantId: a.tenantId, requestId: 'r2' });
    await refuse(returnFor(state, 'c'), 'another person', 'forbidden', colleague);

    // A token that cannot read products, or does not open the shop, is not a connection.
    a.store.codes.set('no-scope', { token: 'shpat_x', scope: 'read_orders' });
    await refuse(returnFor(state, 'no-scope'), 'without read_products', 'validation_failed');
    a.store.codes.set('dead', { token: 'shpat_dead', scope: 'read_products' });
    const accept = a.store.tokens.add.bind(a.store.tokens);
    (a.store.tokens as any).add = (t: string) => (t === 'shpat_dead' ? a.store.tokens : accept(t)); // Shopify hands over a token that then does not work
    await refuse(returnFor(state, 'dead'), 'a token that does not open the shop', 'validation_failed');

    assert.equal((await harness.asAdmin(() => harness.db.select().from(storeConnections))).length, 0, 'nothing saved');
    assert.ok(a.store.codes.has('theirs'), 'the other shop’s code was never spent either');
    assert.ok(a.store.codes.has('c'), 'the code was never spent on a refused return');
  } finally { clearConnectors(); await harness.close(); resetEnv(); }
});
