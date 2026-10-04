/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Products without linking a store: a Google Merchant feed's link (synced now and every 24 hours, its
 * link sealed, private addresses refused) and a file (imported in its own request, not kept, updated by
 * uploading again) — through the same sync engine as a linked store, on every plan.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { products, storeConnections, syncJobs } from '@/db/schema';
import { clearConnectors, registerConnector } from '@/server/connectors/types';
import { FeedConnector } from '@/server/connectors/feed/connector';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { RSS, workbook } from '@/server/testing/feed-fixtures';
import { connectFeed, importProductFile, syncFeedNow } from '@/server/modules/connections/feed';
import { runSyncStep } from '@/server/modules/sync/engine';
import { requestSync } from '@/server/modules/sync/service';

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
