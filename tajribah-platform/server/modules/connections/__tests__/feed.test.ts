/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Products without linking a store: a Google Merchant feed's link (synced now and every 24 hours, its
 * link sealed, private addresses refused) and a file (imported in its own request, not kept, updated by
 * uploading again) — through the same sync engine as a linked store, on every plan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, categories, edgeConfigs, products, storeConnections, syncJobs } from '@/db/schema';
import { clearConnectors, registerConnector } from '@/server/connectors/types';
import { FeedConnector } from '@/server/connectors/feed/connector';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { RSS, workbook } from '@/server/testing/feed-fixtures';
import { connectFeed, importProductFile, syncFeedNow } from '@/server/modules/connections/feed';
import { pageUrlOf, runSyncStep } from '@/server/modules/sync/engine';
import { requestSync } from '@/server/modules/sync/service';
import { disconnectStore, removeStore } from '@/server/modules/connections/service';
import { listProductCategories, listProducts, updateProduct } from '@/server/modules/products/service';

setLogLevel('error');
const LINK = 'https://shop.example.sa/ar/feeds/google-merchant/S3cretT0ken';

/** The internet as the feed reader sees it: DNS over HTTPS, and the feed's own answer. */
function internet(feed: { body: string }, address = '93.184.216.34') {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://cloudflare-dns.com/')) {
      const type = new URL(url).searchParams.get('type');
      return Response.json({ Status: 0, Answer: type === 'A' ? [{ type: 1, data: address }] : [] });
    }
    if (url === LINK) return new Response(feed.body, { headers: { 'content-type': 'application/xml' } });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

async function setup(harness: TestDb, feed: { body: string }) {
  resetEnv();
  loadEnv({ APP_URL: 'https://app.tajribah.sa', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  clearConnectors();
  registerConnector(new FeedConnector(internet(feed)));
  const seeded = await seedTenant(harness, 'feedstore'); // the default plan: feeds are on every plan
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  return { ...seeded, ctx };
}

const syncAll = async (tenantId: string, syncJobId: string) => {
  for (let i = 0; i < 10; i++) if ((await runSyncStep({ tenantId, syncJobId, requestId: 'sync' })).result !== 'more') return;
};
const catalogue = (harness: TestDb, tenantId: string) => harness.asAdmin(() => harness.db.select().from(products).where(eq(products.tenantId, tenantId))) as Promise<any[]>;

test('a feed’s link: checked, sealed, synced now and every 24 hours; a change in the feed reaches the products', async () => {
  const harness = await createTestDb();
  const feed = { body: RSS };
  try {
    const { ctx, tenantId } = await setup(harness, feed);
    const linked = await connectFeed(ctx, { url: LINK }, internet(feed));
    assert.deepEqual([linked.connection.provider, linked.connection.storeName, linked.products, linked.rows], ['feed', 'shop.example.sa', 2, 4]);
    assert.deepEqual(linked.skipped, [{ row: 4, reason: 'no id' }]);
    const [row] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, linked.connection.id))) as any[];
    assert.equal(row.syncIntervalMinutes, 24 * 60, 'read again every 24 hours, like Merchant Center');
    assert.equal(row.storeUrl, 'https://shop.example.sa', 'the store’s own address, for the install check');
    assert.ok(!JSON.stringify(row).includes('S3cretT0ken'), 'the link carries a secret: sealed');

    assert.equal(linked.sync.status, 'done', 'synced in the request: nothing waits on a worker (none runs on a local machine)');
    let rows = await catalogue(harness, tenantId);
    assert.deepEqual(rows.map((p) => [p.externalId, p.nameAr, p.priceMinor, p.status]).sort(), [['200', null, 6000, 'active'], ['W-1', 'ساعة فولاذية', 125000, 'active']]);
    assert.equal(rows.find((p) => p.externalId === 'W-1').images.length, 2);

    // The store changes a price and adds a product; the next read brings both.
    feed.body = RSS.replace('<g:price>60 SAR</g:price>', '<g:price>75 SAR</g:price>')
      .replace('</channel>', '<item><g:id>300</g:id><g:title>Bowl</g:title><g:price>20 SAR</g:price></item></channel>');
    const again = await syncFeedNow(ctx, (await requestSync(ctx, linked.connection.id, { type: 'full' })).id);
    assert.equal(again.status, 'done', '"Sync now" on a feed reads it at once');
    rows = await catalogue(harness, tenantId);
    assert.deepEqual(rows.map((p) => [p.externalId, p.priceMinor]).sort(), [['200', 7500], ['300', 2000], ['W-1', 125000]]);

    // A product taken out of the feed is archived (one of three: under the engine's guard).
    feed.body = feed.body.replace(/<item><g:id>300<\/g:id>[\s\S]*?<\/item>/, '');
    await syncAll(tenantId, (await requestSync(ctx, linked.connection.id, { type: 'full' })).id);
    assert.equal((await catalogue(harness, tenantId)).find((p) => p.externalId === '300').status, 'archived');

    // T72: a size the feed gives fills an empty one; once set, the size is the merchant's.
    feed.body = feed.body.replace('<g:mpn>ARC-1</g:mpn>', '<g:mpn>ARC-1</g:mpn><g:product_width>42 cm</g:product_width><g:product_height>165 cm</g:product_height>');
    await syncFeedNow(ctx, (await requestSync(ctx, linked.connection.id, { type: 'full' })).id);
    const lamp = () => catalogue(harness, tenantId).then((r) => r.find((p) => p.externalId === '200'));
    assert.deepEqual((await lamp()).dimensions, { widthMm: 420, heightMm: 1650 });
    await harness.asAdmin(() => harness.db.update(products).set({ dimensions: { widthMm: 400, heightMm: 1600 } } as any).where(eq(products.externalId, '200')));
    feed.body = feed.body.replace('<g:price>75 SAR</g:price>', '<g:price>80 SAR</g:price>'); // the row is written: the size must still stay
    await syncFeedNow(ctx, (await requestSync(ctx, linked.connection.id, { type: 'full' })).id);
    assert.deepEqual((await lamp()).dimensions, { widthMm: 400, heightMm: 1600 }, 'the merchant’s own size stays');

    // The same link again is the same connection.
    assert.equal((await connectFeed(ctx, { url: LINK }, internet(feed))).connection.id, linked.connection.id);
  } finally { clearConnectors(); await harness.close(); resetEnv(); }
});

test('a link we will not open, or that is not a feed, is refused with the reason — and nothing is saved', async () => {
  const harness = await createTestDb();
  const feed = { body: RSS };
  try {
    const { ctx, tenantId } = await setup(harness, feed);
    const refused = async (url: string, fetchImpl: typeof fetch, pattern: RegExp) => assert.rejects(() => connectFeed(ctx, { url }, fetchImpl),
      (e: any) => e.code === 'validation_failed' && pattern.test(e.errors.url[0]), url);
    await refused(LINK, internet(feed, '10.1.2.3'), /private network/);
    await refused('http://shop.example.sa/feed.xml', internet(feed), /https/);
    await refused('https://shop.example.sa/missing.xml', internet(feed), /answered 404/);
    await refused(LINK, internet({ body: '<html><body>Welcome</body></html>' }), /no products found/);
    const saved = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.tenantId, tenantId)));
    assert.deepEqual(saved, []);
  } finally { clearConnectors(); await harness.close(); resetEnv(); }
});

test('a file: imported in its own request, not kept; uploading again updates it; it is never re-read on its own', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await setup(harness, { body: '' });
    const csv = new TextEncoder().encode('id,title,price,image_link\n1,Lamp,99 SAR,https://cdn.example.sa/1.jpg\n2,Bowl,20 SAR,\n3,Vase,45 SAR,\n');
    const first = await importProductFile(ctx, { filename: 'products.csv', bytes: csv });
    assert.deepEqual([first.connection.storeName, first.products, first.sync.status], ['products.csv', 3, 'done'], 'done before the answer: the file lives only in this request');
    assert.deepEqual((await catalogue(harness, tenantId)).map((p) => [p.externalId, p.name, p.priceMinor]).sort(), [['1', 'Lamp', 9900], ['2', 'Bowl', 2000], ['3', 'Vase', 4500]]);

    // The same sheet as Excel, a price changed and Vase gone: the same connection, updated and archived.
    const xlsx = await workbook([['id', 'title', 'price'], ['1', 'Lamp', '120 SAR'], ['2', 'Bowl', '20 SAR']]);
    const second = await importProductFile(ctx, { filename: 'products.xlsx', bytes: xlsx });
    assert.equal(second.connection.id, first.connection.id, 'one file connection per store');
    const rows = await catalogue(harness, tenantId);
    assert.deepEqual(rows.map((p) => [p.externalId, p.priceMinor, p.status]).sort(), [['1', 12000, 'active'], ['2', 2000, 'active'], ['3', 4500, 'archived']]);

    await assert.rejects(() => requestSync(ctx, first.connection.id), (e: any) => e.code === 'conflict' && /upload the file again/.test(e.message));
    const [row] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, first.connection.id))) as any[];
    assert.ok(row.syncIntervalMinutes > 50 * 365 * 24 * 60, 'the schedule never picks a file up');
    await assert.rejects(() => importProductFile(ctx, { filename: 'x.csv', bytes: new TextEncoder().encode('just words') }), (e: any) => e.code === 'validation_failed');
    const jobs = await harness.asAdmin(() => harness.db.select().from(syncJobs).where(eq(syncJobs.connectionId, first.connection.id))) as any[];
    assert.deepEqual(jobs.map((j) => j.status), ['done', 'done'], 'a refused file starts no sync');
  } finally { clearConnectors(); await harness.close(); resetEnv(); }
});

const FAILET = (watchCategory: string) => `<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel>
  <item><g:id>1</g:id><g:title>ساعة نسائية ماركة فايلت</g:title><g:price>545.00 SAR</g:price><g:product_type>${watchCategory}</g:product_type><g:item_group_id>G1</g:item_group_id></item>
  <item><g:id>2</g:id><g:title>ساعة رجالية</g:title><g:price>360.00 SAR</g:price><g:product_type>ساعات رجالية</g:product_type></item>
  <item><g:id>3</g:id><g:title>طقم زركون فضي</g:title><g:price>672.75 SAR</g:price><g:product_type>أطقم</g:product_type></item>
  <item><g:id>4</g:id><g:title>خاتم</g:title><g:price>50 SAR</g:price><g:product_type>خواتم نسائية</g:product_type></item>
  <item><g:id>5</g:id><g:title>بلا تصنيف</g:title><g:price>10 SAR</g:price></item>
</channel></rss>`;

test('T77: the store’s categories come in as this store’s categories; a type fills only one still "other"; the category follows the store', async () => {
  const harness = await createTestDb();
  const feed = { body: FAILET('ساعات نسائية') };
  try {
    const { ctx, tenantId } = await setup(harness, feed);
    const linked = await connectFeed(ctx, { url: LINK }, internet(feed));
    const LIST = { filter: 'all' as const, limit: 50 };
    const rows = (await listProducts(ctx, LIST)).rows;
    const by = (name: string) => rows.find((r) => r.name === name)!;
    assert.deepEqual([by('ساعة نسائية ماركة فايلت').productType, by('ساعة نسائية ماركة فايلت').category?.name], ['watch', 'ساعات نسائية']);
    assert.deepEqual([by('طقم زركون فضي').productType, by('طقم زركون فضي').category?.name], ['other', 'أطقم'], 'a set: kept as a category, no type guessed');
    assert.deepEqual([by('خاتم').productType, by('بلا تصنيف').category], ['jewelry', null]);
    const cats = await listProductCategories(ctx);
    assert.deepEqual(cats.map((c) => [c.name, c.count]).sort(), [['أطقم', 1], ['خواتم نسائية', 1], ['ساعات رجالية', 1], ['ساعات نسائية', 1]]);
    const watches = cats.find((c) => c.name === 'ساعات نسائية')!;
    assert.deepEqual((await listProducts(ctx, { ...LIST, category: watches.id })).rows.map((r) => r.name), ['ساعة نسائية ماركة فايلت'], 'the list filtered by a category');
    assert.equal((await listProducts(ctx, { ...LIST, category: watches.id })).counts.all, 1, 'counts follow the category');
    assert.deepEqual((await listProducts(ctx, { ...LIST, sort: 'category', dir: 'asc' })).rows.at(-1)!.name, 'بلا تصنيف', 'sorted by category, none last');

    // The merchant sets the set's type; the store moves the women's watch to another category.
    await updateProduct(ctx, by('طقم زركون فضي').id, { productType: 'jewelry' });
    await updateProduct(ctx, by('ساعة رجالية').id, { productType: 'other' });
    await updateProduct(ctx, by('خاتم').id, { productType: 'apparel' }); // the merchant's own choice, though the store says rings
    feed.body = FAILET('ساعات ألماس نسائية').replace('<g:price>50 SAR</g:price>', '<g:price>55 SAR</g:price>'); // the ring's price changes: its row is written
    await syncFeedNow(ctx, (await requestSync(ctx, linked.connection.id, { type: 'full' })).id);
    const after = (await listProducts(ctx, LIST)).rows;
    const now = (name: string) => after.find((r) => r.name === name)!;
    assert.equal(now('ساعة نسائية ماركة فايلت').category?.name, 'ساعات ألماس نسائية', 'the category is the store’s: it follows');
    assert.equal(now('طقم زركون فضي').productType, 'jewelry', 'a type the merchant chose is kept');
    assert.equal(now('خاتم').productType, 'apparel', 'even when the store’s category names another type');
    assert.equal(now('ساعة رجالية').productType, 'watch', 'set back to "other": the store’s category fills it again');
    const stored = await harness.asAdmin(() => harness.db.select().from(categories).where(eq(categories.tenantId, tenantId))) as any[];
    assert.equal(stored.filter((c) => c.name === 'ساعات رجالية').length, 1, 'one row per category, however often it is read');
  } finally { await harness.close(); resetEnv(); clearConnectors(); }
});

test('T95: each product keeps its store page from the feed’s link, and the page follows the store', async () => {
  const harness = await createTestDb();
  const feed = { body: RSS };
  try {
    const { ctx, tenantId } = await setup(harness, feed);
    const linked = await connectFeed(ctx, { url: LINK }, internet(feed));
    const pageOf = async (externalId: string) => (await catalogue(harness, tenantId)).find((p) => p.externalId === externalId).pageUrl;
    assert.equal(await pageOf('W-1'), 'https://shop.example.sa/ar/p101?a=1&b=2', 'the variant group keeps its first row’s link');
    assert.equal(await pageOf('200'), null, 'no link, no page');

    // the store renames the product: its page's address changes, and nothing else does — the new page is kept
    feed.body = RSS.replace('https://shop.example.sa/ar/p101?a=1&amp;b=2', 'https://shop.example.sa/ar/%D8%B3%D8%A7%D8%B9%D8%A9/p1412564664');
    await syncFeedNow(ctx, (await requestSync(ctx, linked.connection.id, { type: 'full' })).id);
    assert.equal(await pageOf('W-1'), 'https://shop.example.sa/ar/%D8%B3%D8%A7%D8%B9%D8%A9/p1412564664');

    // a link that is not a page address is not kept
    feed.body = RSS.replace('https://shop.example.sa/ar/p101?a=1&amp;b=2', 'javascript:alert(1)');
    await syncFeedNow(ctx, (await requestSync(ctx, linked.connection.id, { type: 'full' })).id);
    assert.equal(await pageOf('W-1'), null);
    // what any connector's page goes through before it is stored
    assert.equal(pageUrlOf(' https://shop.example.sa/ar/p1 '), 'https://shop.example.sa/ar/p1');
    assert.equal(pageUrlOf('https://failet.sa/ar/ساعة فضي/p1412564664?tax_profile=sa'), 'https://failet.sa/ar/%D8%B3%D8%A7%D8%B9%D8%A9%20%D9%81%D8%B6%D9%8A/p1412564664?tax_profile=sa', 'written as a browser writes it');
    assert.equal(pageUrlOf('https://failet.sa/ar/{Name}/p1561800183\n'), 'https://failet.sa/ar/%7BName%7D/p1561800183');
    for (const bad of ['javascript:alert(1)', 'ftp://shop.example.sa/p1', 'not a url', `https://shop.example.sa/${'x'.repeat(2050)}`, `https://shop.example.sa/${'ع'.repeat(400)}`, '', null]) assert.equal(pageUrlOf(bad), null, String(bad).slice(0, 40));
  } finally { await harness.close(); resetEnv(); clearConnectors(); }
});

test('T78: a disconnected store is removed with its products — never an active one, never another store’s products', async () => {
  const harness = await createTestDb();
  const feed = { body: FAILET('ساعات نسائية') };
  try {
    const { ctx, tenantId } = await setup(harness, feed);
    const linked = await connectFeed(ctx, { url: LINK }, internet(feed));
    const file = await importProductFile(ctx, { filename: 'mine.csv', bytes: new TextEncoder().encode('id,title\nM-1,مصباح\n') });
    await assert.rejects(() => removeStore(ctx, linked.connection.id), (e: any) => e.code === 'conflict', 'an active store: disconnect first');
    await disconnectStore(ctx, linked.connection.id);
    const one = (await catalogue(harness, tenantId)).find((p) => p.externalId === 'G1');
    await harness.asAdmin(() => harness.db.insert(edgeConfigs).values({ tenantId, productId: one.id, key: 'feedstore/G1.json', version: 1, publishedAt: new Date() } as any));

    const out = await removeStore(ctx, linked.connection.id);
    assert.equal(out.products, 5);
    const rows = await catalogue(harness, tenantId);
    assert.ok(rows.filter((p) => p.connectionId === linked.connection.id).every((p) => p.deletedAt && p.status === 'archived' && !p.arEnabled), 'its products: deleted (soft), archived, 3D off');
    assert.equal(rows.filter((p) => p.connectionId === file.connection.id && !p.deletedAt).length, 1, 'another source’s products stay');
    assert.equal((await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, linked.connection.id))) as any[]).length, 0, 'the link is gone');
    const [trail] = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceId, linked.connection.id))).then((r: any[]) => r.filter((a) => a.action === 'delete'));
    assert.ok(trail, 'recorded once');
    assert.equal((await listProducts(ctx, { filter: 'all', limit: 50 })).counts.all, 1, 'the list no longer shows them');
  } finally { await harness.close(); resetEnv(); clearConnectors(); }
});
