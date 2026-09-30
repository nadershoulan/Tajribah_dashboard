/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T61 — the Salla connector passes the same conformance suite as every connector, against a stand-in
 * that answers as Salla's public documentation shows; and the parts only Salla has — one name per
 * answer (Arabic by default), refresh tokens that work once, times with no zone, prices as JSON
 * numbers, two pagination shapes — are checked on their own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeConformance } from '@/server/connectors/conformance';
import { Transport, type Clock } from '@/server/connectors/transport';
import { TokenRevokedError } from '@/server/connectors/types';
import { nextPage, PER_PAGE, SallaConnector, statusOf, timeOf, toExternal, type SallaApp } from '@/server/connectors/salla/connector';
import { setLogLevel } from '@/server/core/observability/log';
import { SALLA_APP, SallaStore, sallaHolds, sallaTime } from '@/server/testing/salla-store';

setLogLevel('error');

const instant: Clock = { now: () => Date.now(), sleep: async () => {}, random: () => 0 };
const connectorFor = (store: SallaStore, app: SallaApp | null = SALLA_APP) =>
  new SallaConnector(() => app, new Transport('salla', { rate: { requests: 100_000, perMs: 1000 } }, store.fetch, instant));

describeConformance({
  name: 'Salla',
  holds: sallaHolds,
  async start(catalogue) {
    const store = new SallaStore(catalogue);
    return {
      connector: connectorFor(store),
      accessToken: 'salla_at_ok',
      tokens: { accessToken: 'salla_at_ok', refreshToken: 'salla_rt_ok' },
      revokedTokens: { accessToken: 'salla_at_gone', refreshToken: 'salla_rt_gone' },
      setDown: (down) => { store.down = down; },
      change: (id, patch, at) => store.change(id, patch, at),
    };
  },
}, test);

const product = (over: Record<string, unknown> = {}) => ({
  id: 720881993, name: 'بيتزا', description: '<p>سطر<br>وسطر</p>', sku: '', status: 'sale',
  price: { amount: 51.75, currency: 'SAR' }, images: [], updated_at: '2022-05-26 09:45:09', ...over,
}) as any;

test('each page is read in Arabic and in English, 60 at a time, and the two are matched by id', async () => {
  const store = new SallaStore([
    { externalId: 'a', sku: 'S-1', name: 'Gold watch', nameAr: 'ساعة ذهبية', description: null, priceMinor: 125_050, currency: 'SAR', images: [], status: 'active', updatedAt: new Date('2026-09-01T09:00:00Z') },
    { externalId: 'b', sku: null, name: 'iPhone 15', nameAr: null, description: null, priceMinor: 0, currency: 'SAR', images: [], status: 'draft', updatedAt: new Date('2026-09-01T09:00:00Z') },
  ]);
  const page = await connectorFor(store).listProducts('salla_at_ok', null);
  assert.deepEqual(store.languages, ['ar', 'en']);
  assert.deepEqual(page.items.map((p) => [p.externalId, p.name, p.nameAr, p.priceMinor, p.status]), [
    ['700000000', 'Gold watch', 'ساعة ذهبية', 125_050, 'active'],
    ['700000001', 'iPhone 15', null, 0, 'draft'], // a Latin-only name in the Arabic slot is not an Arabic name
  ]);
  assert.deepEqual([page.next, page.total], [null, 2]);
  assert.equal(PER_PAGE, 60, 'Salla’s documented maximum');

  // The English page did not have the product (added between the two reads): the Arabic name stands.
  assert.deepEqual([toExternal(product()).name, toExternal(product()).nameAr], ['بيتزا', 'بيتزا']);
  assert.equal(toExternal(product(), product({ name: 'Pizza' })).name, 'Pizza');
});

test('the parts only Salla has: statuses, times with no zone, prices as numbers, images', () => {
  assert.deepEqual(['sale', 'out', 'hidden', 'deleted', 'something-new'].map(statusOf), ['active', 'active', 'draft', 'archived', 'draft']);

  // "2022-05-26 09:45:09" is Saudi time (UTC+3); a time with its own zone is read as it says.
  assert.equal(timeOf('2022-05-26 09:45:09').toISOString(), '2022-05-26T06:45:09.000Z');
  assert.equal(timeOf('2022-05-26T09:45:09Z').toISOString(), '2022-05-26T09:45:09.000Z');
  assert.equal(sallaTime(new Date('2022-05-26T06:45:09Z')), '2022-05-26 09:45:09', 'the stand-in writes what the connector reads');

  const p = toExternal(product({
    price: { amount: 1250.5, currency: 'sar' }, sku: '  ',
    images: [
      { url: 'https://cdn.salla.sa/a.jpg', alt: '', type: 'image' },
      { url: 'https://cdn.salla.sa/cover.jpg', alt: 'x', type: 'video' },
      { url: 'http://insecure.example/b.jpg', alt: 'b', type: 'image' },
      { url: 'https://cdn.salla.sa/c.jpg', alt: 'من الأمام' },
    ],
  }));
  assert.deepEqual([p.priceMinor, p.currency, p.sku], [125_050, 'SAR', null]);
  assert.equal(p.description, 'سطر\nوسطر');
  assert.deepEqual(p.images, [{ url: 'https://cdn.salla.sa/a.jpg' }, { url: 'https://cdn.salla.sa/c.jpg', alt: 'من الأمام' }], 'videos and non-https pictures are not images; an empty alt is none');
  assert.equal(toExternal(product({ price: { amount: 0.1, currency: 'SAR' } })).priceMinor, 10, 'never float arithmetic');
  assert.equal(toExternal(product({ price: { amount: 5.125, currency: 'SAR' } })).priceMinor, null, 'more decimals than halalas: no price rather than a wrong one');
  assert.equal(toExternal(product({ price: { amount: 1.5, currency: 'KWD' } })).priceMinor, 1500, 'fils are thousandths');
});

test('both pagination shapes Salla documents', () => {
  assert.equal(nextPage({ count: 60, total: 130, perPage: 60, currentPage: 1, totalPages: 3, links: {} }, 1), 2);
  assert.equal(nextPage({ count: 10, total: 130, perPage: 60, currentPage: 3, totalPages: 3, links: {} }, 3), null);
  assert.equal(nextPage({ count: 20, current: 1, next: 'https://api.salla.dev/admin/v2/products?page=2' }, 1), 2);
  assert.equal(nextPage({ count: 20, current: 2, next: null }, 2), null);
  assert.equal(nextPage({ count: 20, current: 2, next: 'https://api.salla.dev/admin/v2/products?page=2' }, 2), null, 'a link back to the same page never loops');
  assert.equal(nextPage(null, 1), null);
});

test('refresh tokens work once: the new pair works, the old access stops, and a second use ends access for good', async () => {
  const store = new SallaStore([]);
  const connector = connectorFor(store);
  const first = await connector.refresh({ accessToken: 'salla_at_ok', refreshToken: 'salla_rt_ok' });
  assert.deepEqual([first.accessToken, first.refreshToken], ['salla_at_1', 'salla_rt_1']);
  assert.ok(first.expiresAt && Math.abs(first.expiresAt.getTime() - (Date.now() + 1_209_599_000)) < 5000, '14 days');
  assert.deepEqual(first.scopes, ['settings.read', 'products.read', 'offline_access']);
  await connector.listProducts(first.accessToken, null);
  await assert.rejects(() => connector.listProducts('salla_at_ok', null), TokenRevokedError, 'the old access token is gone');

  // A second use of the spent refresh token (two jobs racing): Salla revokes everything.
  await assert.rejects(() => connector.refresh({ accessToken: 'salla_at_ok', refreshToken: 'salla_rt_ok' }), TokenRevokedError);
  await assert.rejects(() => connector.listProducts(first.accessToken, null), TokenRevokedError, 'the family is revoked — only a reinstall helps');

  await assert.rejects(() => connector.refresh({ accessToken: 'x' }), TokenRevokedError, 'no refresh token');
  await assert.rejects(() => connectorFor(store, null).refresh({ accessToken: 'x', refreshToken: 'y' }), (e: any) => e.code === 'not_implemented', 'no Salla app yet');
  // Our own keys refused (a setup fault): retried and logged — never a store disconnected.
  const fresh = new SallaStore([]);
  await assert.rejects(() => connectorFor(fresh, { clientId: 'other-app', clientSecret: 'x' }).refresh({ accessToken: 'salla_at_ok', refreshToken: 'salla_rt_ok' }),
    (e: any) => !(e instanceof TokenRevokedError) && e.code?.startsWith('upstream_'));
  assert.equal((await connectorFor(fresh).refresh({ accessToken: 'salla_at_ok', refreshToken: 'salla_rt_ok' })).accessToken, 'salla_at_1', 'and the store’s refresh token is still good'); 
});

test('a throttled store is waited for; a missing product is null; a non-numeric id is not asked about', async () => {
  const store = new SallaStore([{ externalId: 'a', sku: null, name: 'Watch', nameAr: 'ساعة', description: null, priceMinor: 100, currency: 'SAR', images: [], status: 'active', updatedAt: new Date('2026-09-01T09:00:00Z') }]);
  const connector = connectorFor(store);
  store.throttleNext = 2;
  assert.equal((await connector.listProducts('salla_at_ok', null)).items.length, 1, '429 with Retry-After is retried');

  assert.equal((await connector.getProduct('salla_at_ok', '700000000'))?.nameAr, 'ساعة');
  assert.equal(await connector.getProduct('salla_at_ok', '999'), null);
  const before = store.requests;
  assert.equal(await connector.getProduct('salla_at_ok', 'c0001'), null);
  assert.equal(store.requests, before);
  await assert.rejects(() => connector.listProducts('salla_at_ok', 'not-a-page'), /cursor/);
});

test('changed since: every page is read and filtered (Salla has no such filter), with no total', async () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 1, h));
  const catalogue = Array.from({ length: 130 }, (_, i) => ({
    externalId: `p${i}`, sku: null, name: `P ${i}`, nameAr: `منتج ${i}`, description: null, priceMinor: 100, currency: 'SAR', images: [], status: 'active' as const, updatedAt: at(i % 2 ? 12 : 6),
  }));
  const store = new SallaStore(catalogue);
  const connector = connectorFor(store);
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await connector.listProducts('salla_at_ok', cursor, at(12));
    if (pages === 0) assert.equal(page.total, null);
    seen.push(...page.items.map((p) => p.externalId));
    cursor = page.next;
    pages += 1;
  } while (cursor);
  assert.equal(pages, 3, '130 products, 60 a page');
  assert.equal(seen.length, 65);
});

test('answers Salla might give that the stand-in does not: a bare 401 on refresh, a 200 without a list', async () => {
  const answering = (response: () => Response) =>
    new SallaConnector(() => SALLA_APP, new Transport('salla', { rate: { requests: 100_000, perMs: 1000 } }, (async () => response()) as typeof fetch, instant));
  const envelope401 = () => Response.json({ status: 401, success: false, error: { code: 'Unauthorized', message: 'The User is not exists.' } }, { status: 401 });
  await assert.rejects(() => answering(envelope401).refresh({ accessToken: 'a', refreshToken: 'r' }), TokenRevokedError, 'a deleted or inactive user: reconnect, not retry');
  const noList = () => Response.json({ status: 200, success: true, data: { message: null } });
  await assert.rejects(() => answering(noList).listProducts('a', null), (e: any) => e.code?.startsWith('upstream_'), 'never an empty page from a malformed answer');
});
