/**
 * T134.3 — what a QR pairing gives the phone page: the product and the store, read on the server (the config host, the
 * site's own demo list), never taken from the request; the studio's word counts only for the guide's kind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoPairing, kindOf, pairingFromConfig, pairingOfSession, pairRequestOf } from '@site/lib/pair-product';
import { pairingOf, refsOf } from '@site/lib/pair-brand';
import { CONFIG_BASE } from '@site/lib/tryon-config';
import { DEMO_GLASSES, DEMO_WATCH } from '@site/lib/demo-product';

const config = (over: Record<string, unknown> = {}) => ({
  v: 1,
  product: { name: 'Oyster 38', nameAr: 'أويستر 38' },
  tryon: { worn: 'https://cdn.example.test/w.png', flat: 'https://cdn.example.test/f.png', caseMm: 38 },
  page: { store: { name: 'Maison Ward', nameAr: 'ميزون وارد' } },
  brand: null,
  ...over,
});
const pairing = (referer: string | null, url = 'https://tajribah.org/api/pair') =>
  new Request(url, { method: 'POST', headers: referer ? { referer } : {} });

test('a store’s product: its picture, real size and kind from the published config, and the store’s name — never Tajribah', () => {
  const p = pairingFromConfig(config())!;
  assert.deepEqual(p.product, { name: { ar: 'أويستر 38', en: 'Oyster 38' }, worn: 'https://cdn.example.test/w.png', caseMm: 38, kind: 'watch' });
  assert.deepEqual(p.brand, { name: { ar: 'ميزون وارد', en: 'Maison Ward' }, logo: null }, 'every plan: the store’s name from its product page block');
  const branded = pairingFromConfig(config({ brand: { name: 'Maison Ward', nameAr: null, logo: 'https://cdn.example.test/logo.png' } }))!;
  assert.equal(branded.brand?.logo, 'https://cdn.example.test/logo.png', 'white-label (Enterprise): its logo too');
  const ring = pairingFromConfig(config({ tryon: { worn: 'https://cdn.example.test/r.png', flat: 'https://cdn.example.test/r.png', caseMm: 20, category: 'ring' } }))!;
  assert.equal(ring.kind, 'ring');
  assert.equal(pairingFromConfig(config({ page: null }))!.brand, null, 'the page switched off and no white-label: no name, and still no Tajribah');
  assert.equal(pairingFromConfig(config({ tryon: { worn: 'http://cdn.example.test/w.png', flat: 'x', caseMm: 38 } }))?.product ?? null, null, 'a picture not on https: no product');
  assert.equal(pairingFromConfig({ v: 2 }), null);
});

test('the demo: only the site’s own demo products, by SKU — the watch is Failet’s', () => {
  const watch = demoPairing(DEMO_WATCH.sku)!;
  assert.equal(watch.product?.worn, DEMO_WATCH.worn);
  assert.equal(watch.brand?.name.en, 'Failet');
  const glasses = demoPairing(DEMO_GLASSES.sku)!;
  assert.equal(glasses.kind, 'glasses');
  assert.equal(glasses.brand, null, 'a generic example has no store');
  assert.equal(demoPairing('NOT-A-SKU'), null);
  assert.equal(demoPairing({ worn: 'https://evil.example/x.png' }), null);
});

test('the studio’s body: a kind and a demo SKU, nothing else; junk or too long is ignored', () => {
  assert.deepEqual(pairRequestOf(JSON.stringify({ kind: 'ring', demo: 'EX-RING-02' })), { kind: 'ring', demo: 'EX-RING-02' });
  assert.deepEqual(pairRequestOf(JSON.stringify({ kind: 'sword', worn: 'https://evil.example/x.png' })), { kind: null, demo: null });
  assert.deepEqual(pairRequestOf('{not json'), { kind: null, demo: null });
  assert.deepEqual(pairRequestOf(JSON.stringify({ kind: 'ring', pad: 'x'.repeat(2000) })), { kind: null, demo: null });
  assert.equal(kindOf({ category: 'eyewear' }), 'glasses');
  assert.equal(kindOf({}), 'watch');
});

test('the pairing on the server: a store’s product from the config host the frame or product page names; the body cannot add one', async () => {
  const asked: string[] = [];
  const host = (body: unknown) => (async (url: string | URL | Request) => { asked.push(String(url)); return Response.json(body); }) as typeof fetch;
  const forged = JSON.stringify({ kind: 'bag', demo: DEMO_WATCH.sku, worn: 'https://evil.example/x.png' });

  const framed = await pairingOf(pairing('https://tajribah.org/embed/try-on?store=ward&product=sa-1001'), forged, host(config()));
  assert.equal(asked.at(-1), `${CONFIG_BASE}/ward/sa-1001.json`);
  assert.equal(framed.product?.worn, 'https://cdn.example.test/w.png', 'the store’s own product, not the demo the body named');
  assert.equal(framed.kind, 'watch', 'the kind is the product’s, not the body’s');

  await pairingOf(pairing('https://tajribah.org/p/ward/sa-1001'), '', host(config()));
  assert.equal(asked.at(-1), `${CONFIG_BASE}/ward/sa-1001.json`, 'the product’s own page on this site');
  assert.deepEqual(refsOf(pairing('https://evil.example/p/ward/sa-1001')), null, 'another site');

  const local = await pairingOf(pairing('http://127.0.0.1:8799/embed/try-on?store=ward&product=sa-1001', 'http://127.0.0.1:8799/api/pair'), '', host(config()));
  assert.equal(asked.at(-1), 'http://127.0.0.1:8799/v1/ward/sa-1001.json', 'on this computer: its own configs, as the embed page reads them');
  assert.ok(local.product);

  const count = asked.length;
  const demo = await pairingOf(pairing('https://tajribah.org/demo'), JSON.stringify({ kind: 'watch', demo: DEMO_WATCH.sku }), host(config()));
  assert.equal(asked.length, count, 'the demo: nothing fetched');
  assert.equal(demo.product?.worn, DEMO_WATCH.worn);

  const down = await pairingOf(pairing('https://tajribah.org/embed/try-on?store=ward&product=sa-1001'), JSON.stringify({ kind: 'ring' }), (async () => { throw new Error('down'); }) as typeof fetch);
  assert.deepEqual(down, { brand: null, product: null, kind: 'ring' }, 'the host unreachable: no product, the guide for the kind the studio shows');
});

test('a stored session read back is checked again: a broken one cannot break the page', () => {
  assert.deepEqual(pairingOfSession(null), { brand: null, product: null, kind: 'watch' });
  assert.deepEqual(pairingOfSession({ kind: 'necklace', product: { worn: 5 } }), { brand: null, product: null, kind: 'necklace' });
  const ring = { name: { ar: 'خاتم', en: 'Ring' }, caseMm: 20, kind: 'ring' };
  assert.equal(pairingOfSession({ kind: 'ring', product: { ...ring, worn: 5 } }).product, null, 'a picture that is not an address');
  assert.equal(pairingOfSession({ kind: 'ring', product: { ...ring, worn: 'javascript:alert(1)' } }).product, null, 'only a web address or the site’s own pictures');
  assert.equal(pairingOfSession({ kind: 'ring', product: { ...ring, worn: '/assets/ring-top.webp' } }).product?.worn, '/assets/ring-top.webp', 'a demo picture');
  const ok = pairingOfSession({ brand: null, kind: 'ring', product: { name: { ar: 'خاتم', en: 'Ring' }, worn: 'https://cdn.example.test/r.png', caseMm: 20, kind: 'ring' } });
  assert.equal(ok.product?.caseMm, 20);
  assert.equal(ok.kind, 'ring');
});
