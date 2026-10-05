/**
 * T62 — the website on a store's own address (../tajribah-try-on/lib/store-host.ts): only the try-on
 * is served there; anything else is sent to Tajribah's own site; and with no hosts named (this machine,
 * a preview) nothing is restricted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStorePath, markStoreHost, servesHere, siteHosts, STORE_HOST_HEADER, storeHostOf, storeHostRedirect } from '@site/lib/store-host';

const HOSTS = siteHosts(' tajribah.com, WWW.tajribah.com ,');
const to = (address: string, hosts = HOSTS) => storeHostRedirect(new URL(address), hosts);

test('on a store’s own address only its try-on is served; the rest goes to Tajribah’s site', () => {
  assert.deepEqual(HOSTS, ['tajribah.com', 'www.tajribah.com']);
  for (const path of ['/embed/try-on?store=bigco&product=sa-1001&lang=ar', '/capture/0123456789abcdef0123456789abcdef', '/api/pair', '/api/pair/0123456789abcdef0123456789abcdef?image=1',
    '/_next/static/chunks/app.js', '/assets/model-wrist.webp', '/wasm/vision_wasm_internal.wasm', '/brand/tajribah-wordmark.png', '/favicon.ico']) {
    assert.equal(to(`https://ar.bigco.sa${path}`), null, path);
  }
  assert.equal(to('https://ar.bigco.sa/'), 'https://tajribah.com/');
  assert.equal(to('https://ar.bigco.sa/pricing?plan=pro'), 'https://tajribah.com/pricing?plan=pro');
  assert.equal(to('https://ar.bigco.sa/try-on-privacy'), 'https://tajribah.com/try-on-privacy', 'the frame’s privacy link lands on Tajribah’s own page');
  for (const path of ['/embed/try-on/extra', '/capture/not-a-token', '/api/pair/../auth', '/api/contact', '/embed', '/assets']) {
    assert.ok(to(`https://ar.bigco.sa${path}`)?.startsWith('https://tajribah.com/'), path);
  }
  assert.equal(isStorePath('/embed/try-on/'), true);
});

test('Tajribah’s own hosts, this machine and an unconfigured site are served whole', () => {
  for (const address of ['https://tajribah.com/pricing', 'https://WWW.tajribah.com/', 'http://localhost:5173/pricing', 'http://127.0.0.1:8788/']) assert.equal(to(address), null, address);
  assert.equal(to('https://anything.workers.dev/pricing', siteHosts(undefined)), null, 'no hosts named: nothing is restricted');
  assert.deepEqual(siteHosts(''), []);
});

test('P1.19: a store’s address serves its products’ own pages, and every page there knows whose address it is', () => {
  assert.equal(to('https://ar.bigco.sa/p/bigco/sa-1001'), null, 'a product page is served on the store’s address');
  assert.ok(to('https://ar.bigco.sa/p/bigco')?.startsWith('https://tajribah.com/'), 'not a product page: Tajribah’s site');
  assert.ok(to('https://ar.bigco.sa/p/bigco/sa-1001/more')?.startsWith('https://tajribah.com/'));
  assert.equal(storeHostOf(new URL('https://AR.bigco.sa/p/x/y'), HOSTS), 'ar.bigco.sa');
  assert.equal(storeHostOf(new URL('https://tajribah.com/p/x/y'), HOSTS), null);
  assert.equal(storeHostOf(new URL('http://localhost:5173/p/x/y'), HOSTS), null, 'this machine is not a store');
  assert.equal(storeHostOf(new URL('https://ar.bigco.sa/p/x/y'), []), null, 'no hosts named: no store');

  const marked = markStoreHost(new Request('https://ar.bigco.sa/p/bigco/sa-1001', { headers: { [STORE_HOST_HEADER]: 'ar.other.sa' } }), HOSTS);
  assert.equal(marked.headers.get(STORE_HOST_HEADER), 'ar.bigco.sa', 'the address it reached — never the one it claimed');
  const forged = markStoreHost(new Request('https://tajribah.com/p/bigco/sa-1001', { headers: { [STORE_HOST_HEADER]: 'ar.bigco.sa' } }), HOSTS);
  assert.equal(forged.headers.get(STORE_HOST_HEADER), null, 'on Tajribah’s own address an outside mark is removed');
  const plain = new Request('https://tajribah.com/pricing');
  assert.equal(markStoreHost(plain, HOSTS), plain, 'nothing to mark: the request is handed on as it came');

  assert.equal(servesHere(null, null), true, 'Tajribah’s address shows any store’s page');
  assert.equal(servesHere(null, 'ar.bigco.sa'), true);
  assert.equal(servesHere('ar.bigco.sa', 'ar.bigco.sa'), true, 'a store’s address shows its own');
  assert.equal(servesHere('ar.bigco.sa', 'AR.BIGCO.SA'), true);
  assert.equal(servesHere('ar.bigco.sa', 'ar.other.sa'), false, 'never another store’s under its name');
  assert.equal(servesHere('ar.bigco.sa', null), false, 'nor a store’s page with no address of its own');
  assert.equal(servesHere('ar.bigco.sa', undefined), false);
});
