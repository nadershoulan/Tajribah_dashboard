/**
 * P6 — the WooCommerce connector against a **real** WooCommerce (skipped unless `WOO_LIVE_URL` is
 * set). The stand-in store in `woocommerce.test.ts` answers as the REST API is documented to; this
 * asks the real plugin. Set up as in `docs/WOOCOMMERCE-LIVE.md` (a local WordPress Playground with
 * WooCommerce and the seeded products named here), then:
 *
 *   WOO_LIVE_URL=http://127.0.0.1:9400 WOO_LIVE_KEY=ck_… WOO_LIVE_SECRET=cs_… node scripts/test.mjs woocommerce-live
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenRevokedError, type ExternalProduct } from '@/server/connectors/types';
import { WooCommerceConnector, wooToken } from '@/server/connectors/woocommerce/connector';
import { setLogLevel } from '@/server/core/observability/log';

setLogLevel('error');
const url = process.env.WOO_LIVE_URL;
const live = url ? test : test.skip;
const token = () => wooToken({ url: url!, key: process.env.WOO_LIVE_KEY ?? '', secret: process.env.WOO_LIVE_SECRET ?? '' });

async function all(connector: WooCommerceConnector, since?: Date | null) {
  const items: ExternalProduct[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let total: number | null | undefined;
  do {
    const page = await connector.listProducts(token(), cursor, since);
    if (pages === 0) total = page.total;
    items.push(...page.items);
    cursor = page.next;
    pages += 1;
  } while (cursor && pages < 50);
  return { items, pages, total };
}

live('a real WooCommerce: keys, paging, every product as the store holds it, changed-since, one product', async () => {
  const connector = new WooCommerceConnector();
  const kept = await connector.refresh({ accessToken: token() });
  assert.equal(kept.accessToken, token());
  await assert.rejects(() => connector.refresh({ accessToken: wooToken({ url: url!, key: process.env.WOO_LIVE_KEY ?? '', secret: 'cs_wrong' }) }),
    (e: unknown) => e instanceof TokenRevokedError, 'a wrong secret is a revoked key, not an outage');

  const { items, pages, total } = await all(connector);
  assert.equal(items.length, 125, 'five named products and 120 more: drafts and private ones included');
  assert.equal(total, 125);
  assert.equal(pages, 2, '100 a page');
  assert.equal(new Set(items.map((p) => p.externalId)).size, 125, 'none twice');

  const byName = new Map(items.map((p) => [p.name, p]));
  const watch = byName.get('ساعة ذهبية ✨')!;
  assert.deepEqual([watch.nameAr, watch.priceMinor, watch.currency, watch.sku, watch.status], ['ساعة ذهبية ✨', 125_050, 'SAR', 'W-1', 'active']);
  assert.equal(watch.description, 'مقاومة للماء — 50 م.\nالعلبة 38 مم.\n\nفقرة ثانية & رمز', 'WordPress paragraphs back to the text as written');
  const ring = byName.get('Gold ring')!;
  assert.deepEqual([ring.nameAr, ring.priceMinor, ring.sku, ring.description], [null, 0, null, null]);
  assert.equal(byName.get('مسودة')!.status, 'draft');
  assert.equal(byName.get('مخفي')!.status, 'archived', 'private: hidden from the shop');
  assert.equal(byName.get('No price')!.priceMinor, null);
  assert.equal(byName.get('منتج 7')!.priceMinor, 10_725);

  assert.equal((await all(connector, new Date(Date.now() - 24 * 3_600_000))).items.length, 125, 'changed in the last day: all');
  assert.equal((await all(connector, new Date(Date.now() + 3_600_000))).items.length, 0, 'changed after now: none');

  const one = await connector.getProduct(token(), watch.externalId);
  assert.deepEqual(one, watch, 'one product reads exactly as it lists');
  assert.equal(await connector.getProduct(token(), '99999999'), null);
});
