/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeConnections } from '@/db/schema';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { ATTR, WIDGET_SRC } from '@/widget/src/main';
import { embedSnippet, PRODUCT_PLACEHOLDER } from '@/widget/src/snippet';
import { inspectHtml, safeTarget } from '@/server/modules/embed/check';
import { checkInstall, CHECK_MAX_BYTES, snippetFor } from '@/server/modules/embed/service';

setLogLevel('error');
const code = (e: any) => e.code;

test('the snippet is built from the attributes the widget reads, and the checker accepts it', () => {
  const snippet = embedSnippet('failet');
  assert.ok(snippet.includes(`${ATTR.store}="failet"`) && snippet.includes(`${ATTR.product}="${PRODUCT_PLACEHOLDER}"`) && snippet.includes(`src="${WIDGET_SRC}"`));
  assert.equal(inspectHtml(`<html>${snippet}</html>`, 'failet').status, 'template_not_rendered', 'pasted but the theme never filled the product in');
  assert.deepEqual(inspectHtml(`<html>${embedSnippet('failet', '820241410')}</html>`, 'failet'), { status: 'installed', productRef: '820241410' });
  assert.ok(!embedSnippet('fa"><script>x</script>').includes('<script>x'), 'the store key cannot break out of its attribute');
});

test('the HTML inspector names what is wrong', () => {
  const script = (key: string) => `<script src="${WIDGET_SRC}" ${ATTR.store}="${key}" async></script>`;
  const div = (ref: string) => `<div ${ATTR.product}="${ref}"></div>`;
  assert.equal(inspectHtml('<html><body>shop</body></html>', 'failet').status, 'missing_script');
  assert.deepEqual(inspectHtml(script('other-store') + div('1'), 'failet'), { status: 'wrong_store', detail: 'other-store' });
  assert.equal(inspectHtml(script('failet'), 'failet').status, 'missing_placeholder');
  assert.equal(inspectHtml(script('failet') + div(''), 'failet').status, 'template_not_rendered');
  assert.equal(inspectHtml(`<script src="https://cdn.tajribah.com/w/v2/widget.js" ${ATTR.store}='failet'></script>` + div('9'), 'failet').status, 'installed', 'a later widget version counts too');
});

test('the URL guard: https, public domains only, and the store\'s own once connected', () => {
  const refused = ['http://shop.example.sa/p/1', 'https://127.0.0.1/p', 'https://10.0.0.5/', 'https://[::1]/', 'https://localhost/p',
    'https://intranet/', 'https://server.internal/', 'https://shop.example.sa:8443/p', 'https://user:pw@shop.example.sa/', 'ftp://shop.example.sa/', 'not a url'];
  for (const url of refused) assert.equal(safeTarget(url, null).ok, false, url);
  assert.equal(safeTarget('https://shop.example.sa/p/1', null).ok, true);
  assert.equal(safeTarget('https://shop.example.sa/p/1', 'shop.example.sa').ok, true);
  assert.equal(safeTarget('https://www.shop.example.sa/p/1', 'www.shop.example.sa').ok, true);
  assert.equal(safeTarget('https://m.shop.example.sa/p/1', 'shop.example.sa').ok, true, 'a subdomain of the store');
  assert.equal(safeTarget('https://evil.example/p/1', 'shop.example.sa').ok, false);
  assert.equal(safeTarget('https://shop.example.sa.evil.example/', 'shop.example.sa').ok, false);
});

test('checking a live page: installed, redirects re-checked, errors reported, size capped, own domain only', async () => {
  const harness = await createTestDb();
  try {
    const seeded = await seedTenant(harness, 'alpha');
    const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
    const slug = ctx.tenant.slug;
    assert.equal((await snippetFor(ctx)).storeKey, slug);
    const page = (ref: string) => `<html>${embedSnippet(slug, ref)}</html>`;
    const site = (routes: Record<string, () => Response>): typeof fetch => async (input) => {
      const url = String(input);
      return (routes[url] ?? (() => new Response('not found', { status: 404 })))();
    };

    const ok = await checkInstall(ctx, 'https://shop.example.sa/p/1', site({ 'https://shop.example.sa/p/1': () => new Response(page('77')) }));
    assert.deepEqual([ok.status, (ok as any).productRef], ['installed', '77']);

    const hop = await checkInstall(ctx, 'https://shop.example.sa/old', site({
      'https://shop.example.sa/old': () => new Response(null, { status: 301, headers: { location: '/p/2' } }),
      'https://shop.example.sa/p/2': () => new Response(page('88')),
    }));
    assert.equal(hop.status, 'installed', 'a same-site redirect is followed');

    const sneaky = await checkInstall(ctx, 'https://shop.example.sa/go', site({
      'https://shop.example.sa/go': () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } }),
    }));
    assert.equal(sneaky.status, 'unreachable', 'a redirect to an internal address is not followed');
    assert.match((sneaky as any).detail, /IP address/);

    const loop = await checkInstall(ctx, 'https://shop.example.sa/a', site({
      'https://shop.example.sa/a': () => new Response(null, { status: 302, headers: { location: '/a' } }),
    }));
    assert.deepEqual([loop.status, (loop as any).detail], ['unreachable', 'too many redirects']);
    assert.equal((await checkInstall(ctx, 'https://shop.example.sa/x', site({}))).status, 'unreachable');
    assert.equal((await checkInstall(ctx, 'https://shop.example.sa/x', async () => { throw new TypeError('dns'); })).status, 'unreachable');

    const huge = 'x'.repeat(CHECK_MAX_BYTES + 10) + page('99');
    assert.equal((await checkInstall(ctx, 'https://shop.example.sa/big', site({ 'https://shop.example.sa/big': () => new Response(huge) }))).status, 'missing_script', 'nothing past the first 1 MB is read');
    // A page that never stops sending: the checker must stop reading by itself.
    const endless = () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(64 * 1024).fill(120)); } }));
    const bounded = await Promise.race([
      checkInstall(ctx, 'https://shop.example.sa/endless', site({ 'https://shop.example.sa/endless': endless })),
      new Promise((r) => setTimeout(() => r('still reading'), 5000)),
    ]);
    assert.equal((bounded as any).status, 'missing_script', 'stopped at the cap instead of reading forever');

    await assert.rejects(() => checkInstall(ctx, 'http://127.0.0.1/', site({})), (e: any) => code(e) === 'validation_failed' && 'url' in e.errors);
    await harness.asAdmin(() => harness.db.insert(storeConnections).values({ tenantId: seeded.tenantId, provider: 'salla', externalStoreId: 's', storeUrl: 'https://shop.example.sa', status: 'active' } as any));
    await assert.rejects(() => checkInstall(ctx, 'https://someone-else.example/p', site({})), (e: any) => code(e) === 'validation_failed', 'once connected, only the store\'s own pages');
  } finally { await harness.close(); }
});
