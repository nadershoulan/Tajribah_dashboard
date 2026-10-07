/**
 * T62 — the website on a store's own address (../tajribah-try-on/lib/store-host.ts): only the try-on
 * is served there; anything else is sent to Tajribah's own site; and with no hosts named (this machine,
 * a preview) nothing is restricted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStorePath, markStoreHost, servesHere, siteHosts, STORE_HOST_HEADER, storeHostOf, storeHostRedirect } from '@site/lib/store-host';

const HOSTS = siteHosts(' tajribah.org, WWW.tajribah.org ,');
const to = (address: string, hosts = HOSTS) => storeHostRedirect(new URL(address), hosts);

test('on a store’s own address only its try-on is served; the rest goes to Tajribah’s site', () => {
  assert.deepEqual(HOSTS, ['tajribah.org', 'www.tajribah.org']);
  for (const path of ['/embed/try-on?store=bigco&product=sa-1001&lang=ar', '/capture/0123456789abcdef0123456789abcdef', '/api/pair', '/api/pair/0123456789abcdef0123456789abcdef?image=1',
    '/_next/static/chunks/app.js', '/assets/model-wrist.webp', '/wasm/vision_wasm_internal.wasm', '/brand/tajribah-wordmark.png', '/favicon.ico']) {
    assert.equal(to(`https://ar.bigco.sa${path}`), null, path);
  }
  assert.equal(to('https://ar.bigco.sa/'), 'https://tajribah.org/');
  assert.equal(to('https://ar.bigco.sa/pricing?plan=pro'), 'https://tajribah.org/pricing?plan=pro');
  assert.equal(to('https://ar.bigco.sa/try-on-privacy'), 'https://tajribah.org/try-on-privacy', 'the frame’s privacy link lands on Tajribah’s own page');
  for (const path of ['/embed/try-on/extra', '/capture/not-a-token', '/api/pair/../auth', '/api/contact', '/embed', '/assets']) {
    assert.ok(to(`https://ar.bigco.sa${path}`)?.startsWith('https://tajribah.org/'), path);
  }
  assert.equal(isStorePath('/embed/try-on/'), true);
});

test('Tajribah’s own hosts, this machine and an unconfigured site are served whole', () => {
  for (const address of ['https://tajribah.org/pricing', 'https://WWW.tajribah.org/', 'http://localhost:5173/pricing', 'http://127.0.0.1:8788/']) assert.equal(to(address), null, address);
  assert.equal(to('https://anything.workers.dev/pricing', siteHosts(undefined)), null, 'no hosts named: nothing is restricted');
  assert.deepEqual(siteHosts(''), []);
});

test('P1.19: a store’s address serves its products’ own pages, and every page there knows whose address it is', () => {
  assert.equal(to('https://ar.bigco.sa/p/bigco/sa-1001'), null, 'a product page is served on the store’s address');
  assert.ok(to('https://ar.bigco.sa/p/bigco')?.startsWith('https://tajribah.org/'), 'not a product page: Tajribah’s site');
  assert.ok(to('https://ar.bigco.sa/p/bigco/sa-1001/more')?.startsWith('https://tajribah.org/'));
  assert.equal(storeHostOf(new URL('https://AR.bigco.sa/p/x/y'), HOSTS), 'ar.bigco.sa');
  assert.equal(storeHostOf(new URL('https://tajribah.org/p/x/y'), HOSTS), null);
  assert.equal(storeHostOf(new URL('http://localhost:5173/p/x/y'), HOSTS), null, 'this machine is not a store');
  assert.equal(storeHostOf(new URL('https://ar.bigco.sa/p/x/y'), []), null, 'no hosts named: no store');

  const marked = markStoreHost(new Request('https://ar.bigco.sa/p/bigco/sa-1001', { headers: { [STORE_HOST_HEADER]: 'ar.other.sa' } }), HOSTS);
  assert.equal(marked.headers.get(STORE_HOST_HEADER), 'ar.bigco.sa', 'the address it reached — never the one it claimed');
  const forged = markStoreHost(new Request('https://tajribah.org/p/bigco/sa-1001', { headers: { [STORE_HOST_HEADER]: 'ar.bigco.sa' } }), HOSTS);
  assert.equal(forged.headers.get(STORE_HOST_HEADER), null, 'on Tajribah’s own address an outside mark is removed');
  const plain = new Request('https://tajribah.org/pricing');
  assert.equal(markStoreHost(plain, HOSTS), plain, 'nothing to mark: the request is handed on as it came');

  assert.equal(servesHere(null, null), true, 'Tajribah’s address shows any store’s page');
  assert.equal(servesHere(null, 'ar.bigco.sa'), true);
  assert.equal(servesHere('ar.bigco.sa', 'ar.bigco.sa'), true, 'a store’s address shows its own');
  assert.equal(servesHere('ar.bigco.sa', 'AR.BIGCO.SA'), true);
  assert.equal(servesHere('ar.bigco.sa', 'ar.other.sa'), false, 'never another store’s under its name');
  assert.equal(servesHere('ar.bigco.sa', null), false, 'nor a store’s page with no address of its own');
  assert.equal(servesHere('ar.bigco.sa', undefined), false);
});

test('T113: the visit collector is served on ev.tajribah.org — never redirected, which would turn the POST into a GET and lose the event', () => {
  const hosts = siteHosts('tajribah.org,www.tajribah.org,app.tajribah.org');
  assert.equal(storeHostRedirect(new URL('https://ev.tajribah.org/v1/e'), hosts), null);
  assert.equal(storeHostRedirect(new URL('https://ar.oud.sa/v1/e'), hosts), null, 'a store’s own address may carry it too');
  assert.equal(storeHostRedirect(new URL('https://ev.tajribah.org/pricing'), hosts), 'https://tajribah.org/pricing', 'the rest of ev. still goes home');
  assert.equal(isStorePath('/v1/e/extra'), false);
});
