/**
 * P5 (T26) — the storefront opens the owner's studio in a frame: the try-on block is checked
 * strictly (a bad one only turns try-on off), the frame's address carries keys and never the
 * product itself, and only our frame can close it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config';
import { CLOSE_MESSAGE, DEFAULT_TRYON, isCloseFrom, tryOnUrl, warmTryOn } from '../src/tryon';
import { GOOD } from './fixtures';

const TRYON = { worn: 'https://cdn.tajribah.com/t/store/w/worn.png', flat: 'https://cdn.tajribah.com/t/store/w/flat.png', caseMm: 38, sku: 'SFW-38' };
const withTryOn = (tryon: unknown) => ({ ...GOOD, placement: 'wrist', tryon });

test('the try-on block: kept when right; anything off turns try-on off and leaves the AR button', () => {
  assert.deepEqual(parseConfig(withTryOn(TRYON))?.tryon, { ...TRYON, onMe: false }, 'no onMe: the shopper’s own photo is off');
  assert.deepEqual(parseConfig(withTryOn({ ...TRYON, onMe: true }))?.tryon, { ...TRYON, onMe: true }, 'T33: Pro and up');
  for (const odd of ['true', 1, null]) assert.equal(parseConfig(withTryOn({ ...TRYON, onMe: odd }))?.tryon?.onMe, false, `onMe ${JSON.stringify(odd)} is off`);
  assert.equal(parseConfig(GOOD)?.tryon, null, 'absent: no try-on');
  assert.deepEqual(parseConfig(withTryOn({ ...TRYON, sku: undefined }))?.tryon, { ...TRYON, sku: null, onMe: false });
  const bad: unknown[] = [
    { ...TRYON, worn: 'http://cdn.example.test/w.png' }, { ...TRYON, flat: 'javascript:alert(1)' },
    { ...TRYON, caseMm: 4 }, { ...TRYON, caseMm: 81 }, { ...TRYON, caseMm: '38' }, { ...TRYON, sku: 'x'.repeat(65) }, 'yes', [TRYON],
  ];
  for (const tryon of bad) {
    const config = parseConfig(withTryOn(tryon));
    assert.ok(config, `a bad try-on block must not kill the config: ${JSON.stringify(tryon)}`);
    assert.equal(config!.tryon, null);
  }
});

test('the frame’s address: store and product as keys, the page language, the studio host kept', () => {
  const url = new URL(tryOnUrl(DEFAULT_TRYON, 'oud-house', 'SKU 12/ا', 'ar'));
  assert.equal(url.origin + url.pathname, DEFAULT_TRYON);
  assert.deepEqual([url.searchParams.get('store'), url.searchParams.get('product'), url.searchParams.get('lang')], ['oud-house', 'SKU 12/ا', 'ar']);
  assert.ok(!url.href.includes('worn') && !url.href.includes('.png'), 'no product data in the address');
  // A test host with its own query and hash keeps both.
  const local = new URL(tryOnUrl('http://localhost:5195/preview.html?base=x#/embed/try-on', 's', 'p', 'en'));
  assert.deepEqual([local.searchParams.get('base'), local.hash], ['x', '#/embed/try-on']);
});

test('only our frame closes it', () => {
  const frame = {};
  const ok = { origin: 'https://tajribah.com', source: frame, data: { type: CLOSE_MESSAGE } };
  assert.equal(isCloseFrom(ok, 'https://tajribah.com', frame), true);
  assert.equal(isCloseFrom({ ...ok, origin: 'https://evil.example' }, 'https://tajribah.com', frame), false, 'another origin');
  assert.equal(isCloseFrom({ ...ok, source: {} }, 'https://tajribah.com', frame), false, 'another window, even on our origin');
  assert.equal(isCloseFrom({ ...ok, data: { type: 'other' } }, 'https://tajribah.com', frame), false);
  assert.equal(isCloseFrom({ ...ok, data: CLOSE_MESSAGE }, 'https://tajribah.com', frame), false);
});

test('P5.12: a try-on button warms the studio host once — its origin only, nothing about the product', () => {
  const links: { rel: string; href: string }[] = [];
  const doc = {
    head: {
      querySelector: (selector: string) => links.find((l) => selector === `link[rel="preconnect"][href="${l.href}"]`) ?? null,
      appendChild: (node: { rel: string; href: string }) => links.push(node),
    },
    createElement: () => ({ rel: '', href: '' }),
  };
  assert.equal(warmTryOn(doc, DEFAULT_TRYON), true);
  assert.equal(warmTryOn(doc, `${DEFAULT_TRYON}?store=s&product=p`), false, 'once per page');
  assert.deepEqual(links, [{ rel: 'preconnect', href: 'https://tajribah.com' }], 'the website, where the try-on lives (T29)');
  assert.equal(warmTryOn(doc, 'not a url'), false);
  assert.equal(warmTryOn({ ...doc, head: null }, DEFAULT_TRYON), false, 'no head, no harm');
  assert.equal(links.length, 1);
});


test('P1.15: a watch with try-on but no 3D model still gets its button; without try-on it gets none', () => {
  const noModel = { ...withTryOn(TRYON), model: null };
  assert.equal(parseConfig(noModel)?.model, null);
  assert.deepEqual(parseConfig(noModel)?.tryon, { ...TRYON, onMe: false }, 'the button opens the try-on');
  assert.equal(parseConfig({ ...noModel, tryon: undefined }), null, 'nothing to open');
  assert.equal(parseConfig({ ...noModel, tryon: { ...TRYON, caseMm: 4 } }), null, 'a bad try-on block leaves nothing to open');
  assert.equal(parseConfig({ ...noModel, placement: 'floor' }), null, 'only the wrist opens the try-on');
  assert.equal(parseConfig({ ...noModel, model: undefined }), null, 'the model is null or a model, never missing');
});
