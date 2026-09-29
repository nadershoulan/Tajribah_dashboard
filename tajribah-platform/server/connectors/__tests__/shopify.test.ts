/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P6 — the Shopify connector passes the same conformance suite as every connector, against a store
 * double that answers as the GraphQL Admin API does; and the parts only Shopify has — throttling
 * reported inside a 200, the lowest variant's price, media that is not an image, the shop domain —
 * are checked on their own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeConformance } from '@/server/connectors/conformance';
import { Transport, type Clock } from '@/server/connectors/transport';
import { TokenRevokedError } from '@/server/connectors/types';
import { QUERIES, ShopifyConnector, shopifyCredentials, shopifyToken, statusOf, toExternal } from '@/server/connectors/shopify/connector';
import { setLogLevel } from '@/server/core/observability/log';
import { SHOPIFY_SHOP, ShopifyStore, shopifyHolds } from '@/server/testing/shopify-store';

setLogLevel('error');

const instant: Clock = { now: () => Date.now(), sleep: async () => {}, random: () => 0 };
function connectorFor(store: ShopifyStore, sleeps: number[] = []) {
  return new ShopifyConnector(
    new Transport('shopify', { rate: { requests: 100_000, perMs: 1000 } }, store.fetch, instant),
    async (ms) => { sleeps.push(ms); },
  );
}
const OK = shopifyToken({ shop: SHOPIFY_SHOP, token: 'shpat_ok' });
const REVOKED = shopifyToken({ shop: SHOPIFY_SHOP, token: 'shpat_uninstalled' });

describeConformance({
  name: 'Shopify',
  holds: shopifyHolds,
  async start(catalogue) {
    const store = new ShopifyStore(catalogue);
    return {
      connector: connectorFor(store),
      accessToken: OK,
      tokens: { accessToken: OK },
      revokedTokens: { accessToken: REVOKED },
      setDown: (down) => { store.down = down; },
      change: (id, patch, at) => store.change(id, patch, at),
    };
  },
}, test);

test('throttling arrives inside a 200: wait for the points needed, then carry on — or fail loudly', async () => {
  const store = new ShopifyStore([]);
  const sleeps: number[] = [];
  const connector = connectorFor(store, sleeps);
  store.throttleNext = 2;
  const page = await connector.listProducts(OK, null, null);
  assert.deepEqual([page.items.length, page.next], [0, null]);
  // 112 points asked, 12 available, 100 a second restored: one second each time.
  assert.deepEqual(sleeps, [1000, 1000]);

  store.throttleNext = 3;
  await assert.rejects(() => connector.listProducts(OK, null, null), (e: any) => e.code?.startsWith('upstream_'), 'still throttled: the job is retried later');
});

test('the parts only Shopify has', async () => {
  // Statuses; anything new is held back as a draft until someone looks at it.
  assert.deepEqual(['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED'].map(statusOf), ['active', 'draft', 'archived', 'draft']);

  const product = toExternal({
    id: 'gid://shopify/Product/42', legacyResourceId: '42', title: '  ساعة  ', status: 'ACTIVE',
    descriptionHtml: '<p>سطر<br>وسطر</p><p>فقرة</p>', updatedAt: '2026-09-01T10:00:00Z',
    priceRangeV2: { minVariantPrice: { amount: '1250.5', currencyCode: 'SAR' } },
    variants: { nodes: [{ sku: '' }] },
    media: { nodes: [{ image: { url: 'https://cdn.shopify.com/a.jpg', altText: null } }, {}, { image: { url: 'http://insecure.example/b.jpg', altText: 'x' } }] },
  });
  assert.deepEqual([product.externalId, product.name, product.nameAr, product.priceMinor, product.sku], ['42', 'ساعة', 'ساعة', 125_050, null]);
  assert.equal(product.description, 'سطر\nوسطر\n\nفقرة');
  assert.deepEqual(product.images, [{ url: 'https://cdn.shopify.com/a.jpg' }], 'videos and non-https media are not images');

  // The shop domain is checked: a token for anything but *.myshopify.com is not a Shopify token.
  assert.throws(() => shopifyCredentials(shopifyToken({ shop: 'evil.example.com', token: 't' })), TokenRevokedError);
  assert.throws(() => shopifyCredentials('not json'), TokenRevokedError);
  assert.deepEqual(shopifyCredentials(OK), { shop: SHOPIFY_SHOP, token: 'shpat_ok' });

  // A product id that is not a number is not asked about at all.
  const store = new ShopifyStore([]);
  assert.equal(await connectorFor(store).getProduct(OK, 'gid://shopify/Product/1'), null);
  assert.equal(store.requests, 0);

  // Access denied inside a 200 (a scope taken away) asks for a reconnect.
  const denied = new ShopifyStore([]);
  const original = denied.fetch;
  (denied as any).fetch = async (...args: Parameters<typeof fetch>) => { await original(...args); return Response.json({ errors: [{ message: 'Access denied for products field.', extensions: { code: 'ACCESS_DENIED' } }] }); };
  await assert.rejects(() => connectorFor(denied).listProducts(OK, null, null), TokenRevokedError);

  // Any other GraphQL error is loud, never an empty page.
  const broken = new ShopifyStore([]);
  const real = broken.fetch;
  (broken as any).fetch = async (...args: Parameters<typeof fetch>) => { await real(...args); return Response.json({ errors: [{ message: "Field 'productsCount' doesn't exist on type 'QueryRoot'" }] }); };
  await assert.rejects(() => connectorFor(broken).listProducts(OK, null, null), (e: any) => e.code?.startsWith('upstream_'));

  // The queries ask for the fields the mapping reads.
  for (const field of ['legacyResourceId', 'descriptionHtml', 'priceRangeV2', 'updatedAt', 'sortKey: ID', 'productsCount']) assert.ok(QUERIES.first.includes(field), field);
  assert.ok(!QUERIES.next.includes('productsCount'), 'the count is asked once, on the first page');
});

test('pages end where the products end; changed-since lists only what changed; a count Shopify is unsure of is not shown', async () => {
  const catalogue = Array.from({ length: 150 }, (_, i) => ({
    externalId: `p${i}`, sku: null, name: `P ${i}`, nameAr: null, description: null, priceMinor: 100, currency: 'SAR',
    images: [], status: 'active' as const, updatedAt: new Date(Date.UTC(2026, 8, 1, 0, i)),
  }));
  const store = new ShopifyStore(catalogue);
  const connector = connectorFor(store);
  const first = await connector.listProducts(OK, null, null);
  const second = await connector.listProducts(OK, first.next, null);
  assert.deepEqual([first.items.length, first.total, second.items.length, second.next], [100, 150, 50, null], 'two pages, the second the last');

  const later = new Date(Date.UTC(2026, 9, 1));
  store.change('1007', { name: 'Edited' }, later);
  const changed = await connector.listProducts(OK, null, later);
  assert.deepEqual([changed.items.map((p) => p.externalId), changed.total, changed.next], [['1007'], 1, null], 'only the product changed since');

  store.countPrecision = 'AT_LEAST';
  assert.equal((await connector.listProducts(OK, null, null)).total, null, 'past Shopify’s count limit: no total rather than a wrong one');
});

test('money in the currency’s own minor unit, and GraphQL errors beside data are still errors', async () => {
  const at = (amount: string, currencyCode: string) => toExternal({
    id: 'gid://shopify/Product/1', legacyResourceId: '1', title: 'x', status: 'ACTIVE', descriptionHtml: '', updatedAt: '2026-09-01T10:00:00Z',
    priceRangeV2: { minVariantPrice: { amount, currencyCode } }, variants: { nodes: [] }, media: { nodes: [] },
  }).priceMinor;
  assert.deepEqual([at('12.345', 'KWD'), at('3.5', 'BHD'), at('1.15', 'SAR'), at('0.0', 'SAR'), at('19.999', 'SAR')], [12345, 3500, 115, 0, null]);

  const partial = new ShopifyStore([]);
  const real = partial.fetch;
  (partial as any).fetch = async (...args: Parameters<typeof fetch>) => {
    await real(...args);
    return Response.json({ data: { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }, errors: [{ message: 'Internal error. Looks like something went wrong on our end.' }] });
  };
  await assert.rejects(() => connectorFor(partial).listProducts(OK, null, null), (e: any) => e.code?.startsWith('upstream_'), 'an error beside data is not an empty store');
});

test('a read is retried through a store’s bad moment, although it is a POST', async () => {
  const store = new ShopifyStore([]);
  let failures = 2;
  const original = store.fetch;
  (store as any).fetch = async (...args: Parameters<typeof fetch>) => (failures-- > 0 ? new Response('Bad Gateway', { status: 502 }) : original(...args));
  const page = await connectorFor(store).listProducts(OK, null, null);
  assert.deepEqual([page.items.length, page.next], [0, null]);
});
