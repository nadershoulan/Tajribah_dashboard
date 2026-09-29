/**
 * P6 — the WooCommerce connector passes the same conformance suite as every connector, against a
 * store double that answers as the WooCommerce REST API does; and the parts only WooCommerce has —
 * decimal prices in the currency's own minor unit, HTML descriptions, keys that do not expire —
 * are checked on their own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeConformance } from '@/server/connectors/conformance';
import { Transport, type Clock } from '@/server/connectors/transport';
import { TokenRevokedError } from '@/server/connectors/types';
import { WooCommerceConnector, toExternal, wooCredentials, wooToken } from '@/server/connectors/woocommerce/connector';
import { htmlToText, textToHtml } from '@/server/connectors/woocommerce/html';
import { fromMinor, toMinor } from '@/server/connectors/woocommerce/money';
import { setLogLevel } from '@/server/core/observability/log';
import { WOO_URL, WooStore, wooHolds } from '@/server/testing/woo-store';

setLogLevel('error');

/** No real waiting in tests: the transport's backoff sleeps return at once. */
const instant: Clock = { now: () => Date.now(), sleep: async () => {}, random: () => 0 };
const connectorFor = (store: WooStore) =>
  new WooCommerceConnector(new Transport('woocommerce', { rate: { requests: 100_000, perMs: 1000 } }, store.fetch, instant));
const OK = wooToken({ url: WOO_URL, key: 'ck_ok', secret: 'cs_ok' });
const REVOKED = wooToken({ url: WOO_URL, key: 'ck_revoked', secret: 'cs_x' });

describeConformance({
  name: 'WooCommerce',
  holds: wooHolds,
  async start(catalogue) {
    const store = new WooStore(catalogue);
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

test('prices: exact, in the currency’s own minor unit — halalas, and the thousandths of KWD, BHD and OMR', () => {
  assert.equal(toMinor('1250.50', 'SAR'), 125050);
  assert.equal(toMinor('1250.5', 'SAR'), 125050);
  assert.equal(toMinor('0', 'SAR'), 0);
  assert.equal(toMinor('12.345', 'KWD'), 12345, 'fils');
  assert.equal(toMinor('3.5', 'BHD'), 3500);
  assert.equal(toMinor('0.1', 'SAR'), 10, 'never 9.999… from a float');
  assert.equal(toMinor('1.15', 'SAR'), 115, '1.15 × 100 is 114.999… in floating point');
  assert.equal(toMinor('4.35', 'SAR'), 435);
  assert.equal(toMinor('9.995', 'KWD'), 9995);
  assert.equal(toMinor('19.999', 'SAR'), null, 'more decimals than halalas: refused, not rounded');
  assert.equal(toMinor('', 'SAR'), null);
  assert.equal(toMinor('-5', 'SAR'), null);
  assert.equal(toMinor('1,250.00', 'SAR'), null);
  for (const [minor, currency] of [[125050, 'SAR'], [5, 'SAR'], [0, 'SAR'], [12345, 'KWD'], [7, 'OMR'], [900, 'JPY']] as const) {
    assert.equal(toMinor(fromMinor(minor, currency), currency), minor, `${minor} ${currency} round trip`);
  }
});

test('descriptions: WordPress paragraphs and breaks back to plain text, entities decoded, Arabic intact', () => {
  assert.equal(htmlToText('<p>مقاومة للماء &mdash; 50 م.<br />\nالعلبة 38 مم.</p>\n<p>Second &amp; last</p>'), 'مقاومة للماء &mdash; 50 م.\nالعلبة 38 مم.\n\nSecond & last');
  assert.equal(htmlToText('<p><strong>Bold</strong> and <a href="x">a link</a></p>'), 'Bold and a link');
  assert.equal(htmlToText('<p> </p>'), null);
  assert.equal(htmlToText(''), null);
  const text = 'سطر\nسطر ثان\n\n\tنهاية';
  assert.equal(htmlToText(textToHtml(text)), text);
});

test('what WooCommerce cannot say, said once: private is archived; an Arabic name is the Arabic name', () => {
  const base = { id: 7, sku: '', price: '99', description: '', images: [{ src: 'http://insecure.example/x.jpg' }, { src: 'https://cdn.example/y.jpg', alt: '' }], date_modified_gmt: '2026-09-01T09:00:00' };
  const ar = toExternal({ ...base, name: 'ساعة ذهبية &amp; فضية', status: 'private' }, 'SAR');
  assert.deepEqual([ar.name, ar.nameAr, ar.status, ar.sku, ar.priceMinor], ['ساعة ذهبية & فضية', 'ساعة ذهبية & فضية', 'archived', null, 9900]);
  assert.deepEqual(ar.images, [{ url: 'https://cdn.example/y.jpg' }], 'https only; an empty alt is no alt');
  assert.equal(ar.updatedAt.toISOString(), '2026-09-01T09:00:00.000Z', 'the GMT time, read as GMT');
  const en = toExternal({ ...base, name: 'Gold watch', status: 'pending' }, 'SAR');
  assert.deepEqual([en.nameAr, en.status], [null, 'draft']);
});

test('keys do not expire: refresh checks them and keeps them; revoked keys and junk tokens need a reconnect', async () => {
  const store = new WooStore([]);
  const connector = connectorFor(store);
  const kept = await connector.refresh({ accessToken: OK, scopes: ['read'] });
  assert.deepEqual([kept.accessToken, kept.expiresAt], [OK, null]);
  await assert.rejects(() => connector.refresh({ accessToken: REVOKED }), (e: unknown) => e instanceof TokenRevokedError);
  await assert.rejects(() => connector.listProducts(REVOKED, null), (e: unknown) => e instanceof TokenRevokedError, 'a sync with revoked keys asks for a reconnect, not a retry');
  await assert.rejects(() => connector.listProducts('not json', null), (e: unknown) => e instanceof TokenRevokedError);
  assert.deepEqual(wooCredentials(wooToken({ url: 'https://shop.example.sa///', key: 'k', secret: 's' })).url, 'https://shop.example.sa');
  assert.equal(await connector.getProduct(OK, '999999'), null, 'a numeric id WooCommerce answers 404 for: gone, not an error');
});

test('the store currency is asked once and remembered, not on every page', async () => {
  const store = new WooStore(wooHolds([]).length ? [] : []);
  for (let i = 1; i <= 250; i++) store.products.set(i, WooStore.toWoo({ externalId: String(i), sku: null, name: `P${i}`, nameAr: null, description: null, priceMinor: 100, currency: 'SAR', images: [], status: 'active', updatedAt: new Date() }));
  const connector = connectorFor(store);
  let cursor: string | null = null;
  let pages = 0;
  do { const page = await connector.listProducts(OK, cursor); cursor = page.next; pages += 1; } while (cursor);
  assert.equal(pages, 3);
  assert.equal(store.requests, 4, 'one currency call and three pages');
});
