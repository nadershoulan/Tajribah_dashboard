/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeConfigs, products, storeConnections } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { ATTR, WIDGET_SRC } from '@/widget/src/main';
import { embedSnippet, PRODUCT_PLACEHOLDER } from '@/widget/src/snippet';
import { inspectHtml, isPrivateAddress, safeTarget } from '@/server/modules/embed/check';
import { checkInstall, CHECK_MAX_BYTES, DOH_URL, snippetFor } from '@/server/modules/embed/service';

setLogLevel('error');
const code = (e: any) => e.code;
/** A DNS-over-HTTPS answer: `name` → `ip` (A) — public unless a test says otherwise. */
const dns = (url: string, table: Record<string, string> = {}) => {
  const q = new URL(url).searchParams;
  const ip = table[q.get('name')!] ?? '93.184.216.34';
  const v6 = ip.includes(':');
  const answer = (q.get('type') === 'AAAA') === v6 ? [{ type: v6 ? 28 : 1, data: ip }] : [];
  return Response.json({ Status: 0, Answer: answer });
};

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
      if (url.startsWith(DOH_URL)) return dns(url); // T45: every host resolves to a public address here
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

test('T37: installed right — and whether this product’s button is live, not published, taken down, or unknown', async () => {
  const harness = await createTestDb();
  try {
    const seeded = await seedTenant(harness, 'beta');
    const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
    const page = (ref: string): typeof fetch => async (input) => (String(input).startsWith(DOH_URL) ? dns(String(input)) : new Response(`<html>${embedSnippet('beta', ref)}</html>`));
    const own = uuidv7();
    const [synced, made, gone] = await harness.asAdmin(() => harness.db.insert(products).values([
      { tenantId: seeded.tenantId, name: 'Synced watch', nameAr: 'ساعة مزامنة', externalId: 'sa-9' },
      { id: own, tenantId: seeded.tenantId, name: 'Made here' },
      { tenantId: seeded.tenantId, name: 'Taken down', externalId: 'sa-10' },
      { tenantId: seeded.tenantId, name: 'Deleted', externalId: 'sa-11', deletedAt: new Date(), status: 'archived' },
    ] as any).returning()) as any[];
    await harness.asAdmin(() => harness.db.insert(edgeConfigs).values([
      { id: uuidv7(), tenantId: seeded.tenantId, productId: synced.id, key: 'beta/sa-9.json', version: 3, fingerprint: 'f', publishedAt: new Date() },
      { id: uuidv7(), tenantId: seeded.tenantId, productId: gone.id, key: 'beta/sa-10.json', version: 2, fingerprint: 'f', publishedAt: new Date(), withdrawnAt: new Date() },
    ] as any));
    const at = async (ref: string) => (await checkInstall(ctx, 'https://shop.example.sa/p', page(ref))) as any;
    assert.deepEqual((await at('sa-9')).product, { productId: synced.id, name: 'Synced watch', nameAr: 'ساعة مزامنة', state: 'live', version: 3 });
    assert.deepEqual([(await at(own)).product.productId, (await at(own)).product.state], [made.id, 'not_published'], 'a product made in the dashboard is found by its own id');
    assert.deepEqual([(await at('sa-10')).product.state, (await at('sa-10')).product.version], ['withdrawn', 0]);
    assert.equal((await at('sa-404')).product, null, 'no product has this id');
    assert.equal((await at('sa-11')).product, null, 'a deleted product is not in the catalogue');
    assert.equal((await at(synced.id)).product, null, 'a synced product is addressed by its platform id, not ours — as the config key is');
  } finally { await harness.close(); }
});

test('T45 (P7.7): a public-looking name that points inward is refused; so is one we cannot look up', async () => {
  const privateOnes = ['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.16.3.4', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1',
    '::1', '::', 'fd00::1', 'fc12::1', 'fe80::1', '::ffff:10.0.0.1', 'not-an-ip'];
  for (const ip of privateOnes) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:93.184.216.34', '8.8.8.8']) assert.equal(isPrivateAddress(ip), false, ip);

  const harness = await createTestDb();
  try {
    const seeded = await seedTenant(harness, 'gamma');
    const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
    const html = new Response(`<html>${embedSnippet('gamma', '1')}</html>`);
    const fetched: string[] = [];
    const net = (table: Record<string, string>, doh: 'ok' | 'down' = 'ok'): typeof fetch => async (input) => {
      const url = String(input);
      if (url.startsWith(DOH_URL)) return doh === 'down' ? new Response('', { status: 503 }) : dns(url, table);
      fetched.push(url);
      if (url === 'https://shop.example.sa/go') return new Response(null, { status: 302, headers: { location: 'https://inside.example.sa/admin' } });
      return html.clone();
    };
    const inward = await checkInstall(ctx, 'https://sneaky.example.sa/p', net({ 'sneaky.example.sa': '169.254.169.254' }));
    assert.deepEqual([inward.status, (inward as any).detail], ['unreachable', 'the address points to a private network, which we will not open']);
    assert.equal((await checkInstall(ctx, 'https://v6.example.sa/p', net({ 'v6.example.sa': 'fd00::5' }))).status, 'unreachable');
    const hop = await checkInstall(ctx, 'https://shop.example.sa/go', net({ 'inside.example.sa': '10.1.2.3' }));
    assert.equal(hop.status, 'unreachable', 'a redirect to a name that points inward is not followed');
    assert.equal((await checkInstall(ctx, 'https://shop.example.sa/p', net({}, 'down'))).status, 'unreachable', 'no lookup, no fetch');
    assert.deepEqual(fetched, ['https://shop.example.sa/go'], 'nothing inward, and nothing unlooked-up, was ever fetched');
    assert.equal((await checkInstall(ctx, 'https://shop.example.sa/p', net({}))).status, 'installed', 'a public address is checked as before');
  } finally { await harness.close(); }
});
