/**
 * T62 — the website on a store's own address (../tajribah-try-on/lib/store-host.ts): only the try-on
 * is served there; anything else is sent to Tajribah's own site; and with no hosts named (this machine,
 * a preview) nothing is restricted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStorePath, siteHosts, storeHostRedirect } from '../../../tajribah-try-on/lib/store-host';

const HOSTS = siteHosts(' tajribah.sa, WWW.tajribah.sa ,');
const to = (address: string, hosts = HOSTS) => storeHostRedirect(new URL(address), hosts);

test('on a store’s own address only its try-on is served; the rest goes to Tajribah’s site', () => {
  assert.deepEqual(HOSTS, ['tajribah.sa', 'www.tajribah.sa']);
  for (const path of ['/embed/try-on?store=bigco&product=sa-1001&lang=ar', '/capture/0123456789abcdef0123456789abcdef', '/api/pair', '/api/pair/0123456789abcdef0123456789abcdef?image=1',
    '/_next/static/chunks/app.js', '/assets/model-wrist.webp', '/wasm/vision_wasm_internal.wasm', '/brand/tajribah-wordmark.png', '/favicon.ico']) {
    assert.equal(to(`https://ar.bigco.sa${path}`), null, path);
  }
  assert.equal(to('https://ar.bigco.sa/'), 'https://tajribah.sa/');
  assert.equal(to('https://ar.bigco.sa/pricing?plan=pro'), 'https://tajribah.sa/pricing?plan=pro');
  assert.equal(to('https://ar.bigco.sa/try-on-privacy'), 'https://tajribah.sa/try-on-privacy', 'the frame’s privacy link lands on Tajribah’s own page');
  for (const path of ['/embed/try-on/extra', '/capture/not-a-token', '/api/pair/../auth', '/api/contact', '/embed', '/assets']) {
    assert.ok(to(`https://ar.bigco.sa${path}`)?.startsWith('https://tajribah.sa/'), path);
  }
  assert.equal(isStorePath('/embed/try-on/'), true);
});

test('Tajribah’s own hosts, this machine and an unconfigured site are served whole', () => {
  for (const address of ['https://tajribah.sa/pricing', 'https://WWW.tajribah.sa/', 'http://localhost:5173/pricing', 'http://127.0.0.1:8788/']) assert.equal(to(address), null, address);
  assert.equal(to('https://anything.workers.dev/pricing', siteHosts(undefined)), null, 'no hosts named: nothing is restricted');
  assert.deepEqual(siteHosts(''), []);
});
