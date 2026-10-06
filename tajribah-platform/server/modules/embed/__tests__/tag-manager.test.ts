/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T95 — the install checker and a store that installs through Google Tag Manager: the page's HTML has no
 * script of ours, so the containers it loads are read from Google and searched for our tag; the product is
 * the page's own (`page:p…`), found by the page address its feed gave.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeConfigs, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { ATTR, WIDGET_SRC } from '@/widget/src/main';
import { tagManagerSnippet } from '@/widget/src/snippet';
import { inspectContainer, tagManagerIds } from '@/server/modules/embed/check';
import { checkInstall, DOH_URL, snippetFor, TAG_MANAGER_URL } from '@/server/modules/embed/service';

setLogLevel('error');

/** A published container as Google serves it: the Custom HTML is a JavaScript string, with `<`, `>` and `/` escaped. */
const container = (...tags: string[]) => `(function(){var data = {"resource":{"version":"7","tags":[${tags.map((html) =>
  `{"function":"__html","vtp_html":${JSON.stringify(html).replace(/</g, '\\u003C').replace(/>/g, '\\u003E').replace(/\//g, '\\/')},"vtp_supportDocumentWrite":false}`).join(',')}]}};})();`;
const SALLA_PAGE = `<html lang="ar"><head><script>(function(w,d,s,l,i){j.src='https://www.googletagmanager.com/gtm.js?id='+i})(window,document,'script','dataLayer','GTM-TGFC6FV');</script>
  <script async src="https://www.googletagmanager.com/gtm.js?id=GTM-K4ZVD3HX"></script></head><body class="product-single">
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TGFC6FV" height="0" width="0"></iframe></noscript>
  <salla-hook name="product:single.form.end"></salla-hook><salla-add-product-button product-id="1412564664">أضف للسلة</salla-add-product-button></body></html>`;
const PRODUCT_URL = 'https://failet.sa/ar/%D8%B3%D8%A7%D8%B9%D8%A9-%D8%B1%D8%AC%D8%A7%D9%84%D9%8A%D8%A9/p1412564664';

test('the containers a page loads, and what a published container says about our tag', () => {
  assert.deepEqual(tagManagerIds(SALLA_PAGE), ['GTM-TGFC6FV', 'GTM-K4ZVD3HX'], 'Salla’s own and the store’s, each once');
  assert.deepEqual(tagManagerIds('<html>no tag manager</html>'), []);
  const ours = tagManagerSnippet('failet');
  assert.deepEqual(inspectContainer(container('<script>other()</script>', ours), 'failet'), { status: 'ok' }, 'the tag the install page gives is recognised');
  assert.deepEqual(inspectContainer(container(tagManagerSnippet('failet', { consent: true, anchor: '.price' })), 'failet'), { status: 'ok' });
  assert.deepEqual(inspectContainer(container('<script>other()</script>'), 'failet'), { status: 'missing' });
  assert.deepEqual(inspectContainer(container(tagManagerSnippet('another-store')), 'failet'), { status: 'wrong_store', key: 'another-store' });
  assert.deepEqual(inspectContainer(container(`<script src="${WIDGET_SRC}" ${ATTR.store}="failet" async></script>`), 'failet'), { status: 'not_auto' }, 'the template’s script, pasted without self-placing, finds no product');
  assert.deepEqual(inspectContainer(`"vtp_html":"\\x3cscript src=\\x22${WIDGET_SRC.replace(/\//g, '\\/')}\\x22 ${ATTR.store}=\\x22failet\\x22 ${ATTR.auto}=\\x22salla\\x22\\x3e\\x3c\\/script\\x3e"`, 'failet'), { status: 'ok' }, 'hex escapes too');
});

test('checking a Salla page installed through Tag Manager: the tag, the page’s product, and its button', async () => {
  const harness = await createTestDb();
  try {
    const seeded = await seedTenant(harness, 'failet');
    const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
    const [, silver] = await harness.asAdmin(() => harness.db.insert(products).values([
      { tenantId: seeded.tenantId, name: 'Silver watch (from a file)', externalId: 'file-1', pageUrl: PRODUCT_URL }, // the same page imported twice, never published
      { tenantId: seeded.tenantId, name: 'Silver watch', nameAr: 'ساعة رجالية فضي', externalId: '244167095', connectionId: uuidv7(), pageUrl: `${PRODUCT_URL}?utm_source=feed` },
      { tenantId: seeded.tenantId, name: 'Made in Tajribah' }, // published, but it has no store page
      { tenantId: seeded.tenantId, name: 'Not published', externalId: '24517040', pageUrl: 'https://failet.sa/ar/x/p2114755498' },
    ] as any).returning()) as any[];
    const made = (await harness.asAdmin(() => harness.db.select().from(products)) as any[]).find((p) => p.name === 'Made in Tajribah');
    await harness.asAdmin(() => harness.db.insert(edgeConfigs).values([
      { id: uuidv7(), tenantId: seeded.tenantId, productId: silver.id, key: 'failet/244167095.json', pageKey: 'failet/page%3Ap1412564664.json', version: 4, fingerprint: 'f', publishedAt: new Date() },
      { id: uuidv7(), tenantId: seeded.tenantId, productId: made.id, key: `failet/${made.id}.json`, version: 1, fingerprint: 'f', publishedAt: new Date() },
    ] as any));

    const served: string[] = [];
    const web = (containers: Record<string, string | null>): typeof fetch => async (input) => {
      const url = String(input);
      if (url.startsWith(DOH_URL)) return Response.json({ Status: 0, Answer: new URL(url).searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
      if (url.startsWith(TAG_MANAGER_URL)) {
        served.push(url);
        const js = containers[new URL(url).searchParams.get('id')!];
        return js === null || js === undefined ? new Response('', { status: 404 }) : new Response(js);
      }
      return new Response(SALLA_PAGE);
    };
    const tagged = { 'GTM-TGFC6FV': container('<script>salla()</script>'), 'GTM-K4ZVD3HX': container(tagManagerSnippet('failet')) };

    const live = await checkInstall(ctx, PRODUCT_URL, web(tagged)) as any;
    assert.deepEqual([live.status, live.via, live.productRef], ['installed', 'tag_manager', 'page:p1412564664']);
    assert.deepEqual(live.product, { productId: silver.id, name: 'Silver watch', nameAr: 'ساعة رجالية فضي', state: 'live', version: 4 }, 'found by its page — the live copy, when the page was imported twice');
    assert.deepEqual(served, [`${TAG_MANAGER_URL}GTM-TGFC6FV`, `${TAG_MANAGER_URL}GTM-K4ZVD3HX`], 'only Google’s address, with the ids the page names');

    assert.equal((await checkInstall(ctx, 'https://failet.sa/ar/x/p2114755498', web(tagged)) as any).product.state, 'not_published');
    assert.equal((await checkInstall(ctx, 'https://failet.sa/ar/y/p999999999', web(tagged)) as any).product, null, 'a page no product of the store has');
    assert.deepEqual(await checkInstall(ctx, 'https://failet.sa/ar', web(tagged)), { status: 'not_product_page', detail: null, url: 'https://failet.sa/ar' });

    const untagged = await checkInstall(ctx, PRODUCT_URL, web({ 'GTM-TGFC6FV': container('<script>salla()</script>'), 'GTM-K4ZVD3HX': container() })) as any;
    assert.deepEqual([untagged.status, untagged.detail], ['tag_manager_missing', 'GTM-TGFC6FV, GTM-K4ZVD3HX'], 'linked, but our tag was never added or published');
    assert.equal((await checkInstall(ctx, PRODUCT_URL, web({ 'GTM-K4ZVD3HX': container(`<script src="${WIDGET_SRC}" ${ATTR.store}="failet"></script>`) })) as any).status, 'tag_needs_update');
    assert.deepEqual(await checkInstall(ctx, PRODUCT_URL, web({ 'GTM-K4ZVD3HX': container(tagManagerSnippet('someone-else')) })), { status: 'wrong_store', detail: 'someone-else', url: PRODUCT_URL });
    assert.deepEqual(await checkInstall(ctx, PRODUCT_URL, web({})), { status: 'unreachable', detail: 'we could not read your Google Tag Manager container', url: PRODUCT_URL });

    // a page without any Tag Manager is simply missing our script, as before
    const plain = await checkInstall(ctx, PRODUCT_URL, async (input) => (String(input).startsWith(DOH_URL) ? web({})(input) : new Response('<html><body>shop</body></html>'))) as any;
    assert.equal(plain.status, 'missing_script');

    // the install page: the tag, and how many live products a page-wide tag can find
    const info = await snippetFor(ctx);
    assert.equal(info.tagSnippet, tagManagerSnippet('failet'));
    assert.deepEqual([info.published, info.publishedFromStore, info.publishedWithPage], [2, 1, 1], 'one made in Tajribah: published, but never findable by its page');
  } finally { await harness.close(); }
});
