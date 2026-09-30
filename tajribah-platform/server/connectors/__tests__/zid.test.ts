/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T61 — the Zid connector passes the same conformance suite as every connector, against a stand-in
 * that answers as Zid's public documentation shows (and, for refusals, as Zid's real servers do); and
 * the parts only Zid has — three-part credentials, both languages in one answer, the price a shopper
 * pays, refusals that are ours rather than the store's — are checked on their own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeConformance } from '@/server/connectors/conformance';
import { Transport, type Clock } from '@/server/connectors/transport';
import { TokenRevokedError } from '@/server/connectors/types';
import { PER_PAGE, ZidConnector, nextPage, statusOf, toExternal, zidCredentials, zidToken, type ZidApp } from '@/server/connectors/zid/connector';
import { setLogLevel } from '@/server/core/observability/log';
import { ZID_APP, ZID_STORE_ID, ZidStore, zidHolds } from '@/server/testing/zid-store';

setLogLevel('error');

const instant: Clock = { now: () => Date.now(), sleep: async () => {}, random: () => 0 };
const connectorFor = (store: ZidStore, app: ZidApp | null = ZID_APP) =>
  new ZidConnector(() => app, new Transport('zid', { rate: { requests: 100_000, perMs: 1000 } }, store.fetch, instant));
const OK = zidToken({ authorization: 'zid_auth_ok', manager: 'zid_manager_ok', storeId: ZID_STORE_ID });
const GONE = zidToken({ authorization: 'zid_auth_gone', manager: 'zid_manager_gone', storeId: ZID_STORE_ID });

describeConformance({
  name: 'Zid',
  holds: zidHolds,
  async start(catalogue) {
    const store = new ZidStore(catalogue);
    return {
      connector: connectorFor(store),
      accessToken: OK,
      tokens: { accessToken: OK, refreshToken: 'zid_rt_ok' },
      revokedTokens: { accessToken: GONE, refreshToken: 'zid_rt_gone' },
      setDown: (down) => { store.down = down; },
      change: (id, patch, at) => store.change(id, patch, at),
    };
  },
}, test);

const product = (over: Record<string, unknown> = {}) => ({
  id: 'a497974d-1755-423a-b06c-e0578ba8c318', sku: 'WH-1000XX3', name: { ar: 'سماعة', en: 'Headphones' },
  short_description: { ar: '<p>سطر<br>وسطر</p>', en: '' }, price: 257, sale_price: 199, currency: 'SAR',
  images: [], is_published: true, is_draft: false, updated_at: '2026-02-11T10:21:46.786699Z', ...over,
}) as any;

test('the parts only Zid has: both languages at once, the price a shopper pays, published or not, pictures', () => {
  const p = toExternal(product());
  assert.deepEqual([p.externalId, p.name, p.nameAr, p.priceMinor, p.currency, p.status], ['a497974d-1755-423a-b06c-e0578ba8c318', 'Headphones', 'سماعة', 19_900, 'SAR', 'active']);
  assert.equal(p.description, 'سطر\nوسطر');
  assert.equal(p.updatedAt.toISOString(), '2026-02-11T10:21:46.786Z', 'microseconds, as Zid writes them');
  assert.equal(toExternal(product({ sale_price: null })).priceMinor, 25_700, 'no sale: the price');
  assert.equal(toExternal(product({ price: 0.1, sale_price: null })).priceMinor, 10, 'never float arithmetic');
  assert.equal(toExternal(product({ price: 1.5, sale_price: null, currency: 'KWD' })).priceMinor, 1500, 'fils are thousandths');
  assert.equal(toExternal(product({ price: 1.005, sale_price: null })).priceMinor, null, 'more decimals than halalas: no price rather than a wrong one');
  assert.equal(toExternal(product({ name: { ar: 'iPhone', en: '' } })).nameAr, null, 'a Latin name is not an Arabic name');
  assert.equal(toExternal(product({ name: { ar: 'ساعة', en: '' } })).name, 'ساعة', 'no English name: the Arabic one');
  assert.equal(toExternal(product({ name: 'Mug' })).name, 'Mug', 'a plain name, should one come');
  assert.equal(toExternal(product({ sku: '' })).sku, null);
  assert.deepEqual([statusOf({ is_published: true }), statusOf({ is_published: false }), statusOf({ is_published: true, is_draft: true })], ['active', 'draft', 'draft']);
  const pictures = toExternal(product({
    images: [
      { image: { full_size: 'https://media.zid.store/a.jpg' }, alt_text: '' },
      { image: { full_size: 'http://insecure.example/b.jpg' }, alt_text: 'b' },
      { image: null, alt_text: 'c' },
      { image: { full_size: 'https://media.zid.store/d.jpg' }, alt_text: 'من الأمام' },
    ],
  })).images;
  assert.deepEqual(pictures, [{ url: 'https://media.zid.store/a.jpg' }, { url: 'https://media.zid.store/d.jpg', alt: 'من الأمام' }]);
});

test('credentials: the two tokens and the store, or not a Zid token at all', () => {
  assert.deepEqual(zidCredentials(OK), { authorization: 'zid_auth_ok', manager: 'zid_manager_ok', storeId: ZID_STORE_ID });
  for (const bad of ['nonsense', JSON.stringify({ authorization: 'a', manager: 'm' }), JSON.stringify({ authorization: 'a', manager: '', storeId: '3' }), JSON.stringify({ authorization: 'a', manager: 'm', storeId: 'oud' })]) {
    assert.throws(() => zidCredentials(bad), TokenRevokedError, bad);
  }
});

test('refresh: new tokens for the same store; a spent refresh token ends access; our own keys refused is a setup fault', async () => {
  const store = new ZidStore([]);
  const connector = connectorFor(store);
  const next = await connector.refresh({ accessToken: OK, refreshToken: 'zid_rt_ok', scopes: ['products.read'] });
  assert.deepEqual(zidCredentials(next.accessToken), { authorization: 'zid_auth_1', manager: 'zid_manager_1', storeId: ZID_STORE_ID });
  assert.equal(next.refreshToken, 'zid_rt_1');
  assert.ok(next.expiresAt && Math.abs(next.expiresAt.getTime() - (Date.now() + 31_536_000_000)) < 5000, 'a year');
  assert.deepEqual(next.scopes, ['products.read']);
  assert.equal((await connector.listProducts(next.accessToken, null)).total, 0, 'the new tokens open the store');

  await assert.rejects(() => connector.refresh({ accessToken: OK, refreshToken: 'zid_rt_ok' }), TokenRevokedError, 'spent');
  await assert.rejects(() => connector.refresh({ accessToken: OK }), TokenRevokedError, 'none');
  const fresh = new ZidStore([]);
  await assert.rejects(() => connectorFor(fresh, { ...ZID_APP, clientSecret: 'wrong' }).refresh({ accessToken: OK, refreshToken: 'zid_rt_ok' }),
    (e: any) => !(e instanceof TokenRevokedError) && e.code?.startsWith('upstream_'), 'Zid’s real answer to unknown app keys');
  assert.equal(zidCredentials((await connectorFor(fresh).refresh({ accessToken: OK, refreshToken: 'zid_rt_ok' })).accessToken).manager, 'zid_manager_1', 'and the store’s refresh token is still good');
  await assert.rejects(() => connectorFor(fresh, null).refresh({ accessToken: OK, refreshToken: 'x' }), (e: any) => e.code === 'not_implemented');
});

test('pages of 50 by creation time; throttling waited for; a missing product is null; a non-UUID is not asked about', async () => {
  const catalogue = Array.from({ length: 120 }, (_, i) => ({
    externalId: `p${i}`, sku: null, name: `P ${i}`, nameAr: `منتج ${i}`, description: null, priceMinor: 100, currency: 'SAR', images: [], status: 'active' as const, updatedAt: new Date(Date.UTC(2026, 8, 1, i % 2 ? 12 : 6)),
  }));
  const store = new ZidStore(catalogue);
  const connector = connectorFor(store);
  store.throttleNext = 2;
  const first = await connector.listProducts(OK, null);
  assert.deepEqual([first.items.length, first.next, first.total, PER_PAGE], [50, '2', 120, 50]);
  const since = new Date(Date.UTC(2026, 8, 1, 12));
  let cursor: string | null = null; let seen = 0; let pages = 0;
  do { const page = await connector.listProducts(OK, cursor, since); if (pages === 0) assert.equal(page.total, null); seen += page.items.length; cursor = page.next; pages += 1; } while (cursor);
  assert.deepEqual([pages, seen], [3, 60], 'every page read, the changed ones kept');

  assert.equal((await connector.getProduct(OK, '00000000-0000-4000-8000-000000000001'))?.nameAr, 'منتج 0');
  assert.equal(await connector.getProduct(OK, '00000000-0000-4000-8000-999999999999'), null);
  const before = store.requests;
  assert.equal(await connector.getProduct(OK, '42'), null);
  assert.equal(store.requests, before);
  await assert.rejects(() => connector.listProducts(OK, 'x'), /cursor/);

  assert.equal(nextPage('http://api.zid.sa/v1/products/?page=3&page_size=50', 2), 3, 'Zid writes its next address over http — only the page is read');
  assert.equal(nextPage('http://api.zid.sa/v1/products/?page=2', 2), null, 'never the same page again');
  assert.equal(nextPage('not a url', 1), null);
  assert.equal(nextPage(null, 1), null);
});

test('answers the stand-in does not give: a 200 without a list, a refusal of the store id', async () => {
  const answering = (response: () => Response) =>
    new ZidConnector(() => ZID_APP, new Transport('zid', { rate: { requests: 100_000, perMs: 1000 } }, (async () => response()) as typeof fetch, instant));
  await assert.rejects(() => answering(() => Response.json({ count: 3, next: null })).listProducts(OK, null), (e: any) => e.code?.startsWith('upstream_'), 'never an empty page from a malformed answer');
  await assert.rejects(() => answering(() => Response.json({ detail: 'You do not have permission.' }, { status: 403 })).listProducts(OK, null), TokenRevokedError, 'a store that took our access away');
  await assert.rejects(() => answering(() => Response.json({ status: 'error', message: { description: 'Internal Server Error' } }, { status: 500 })).refresh({ accessToken: OK, refreshToken: 'r' }), (e: any) => e.code?.startsWith('upstream_'), 'Zid down: try again, not disconnected');
});
