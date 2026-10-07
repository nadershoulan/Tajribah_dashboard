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

/** Just enough of an element for `openTryOn` (no DOM library in these tests). */
class El {
  className = ''; textContent = ''; type = ''; src = ''; title = ''; allow = ''; referrerPolicy = '';
  attrs = new Map<string, string>();
  children: El[] = [];
  parent: El | null = null;
  shadow: El | null = null;
  activeElement: El | null = null;
  contentWindow = {};
  style: Record<string, string> = {};
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  attachShadow() { this.shadow = new El('#shadow'); return this.shadow; }
  appendChild(child: El) { child.parent = this; this.children.push(child); return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener(type: string, fn: (e: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  fire(type: string, event: unknown) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  focus() { /* focus moves */ }
}

test('T100: the try-on opens in a window over the product page, in a layer of its own — a tap outside closes it', async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window };
  const body = new El('body');
  body.style.overflow = 'auto';
  g.document = { createElement: (tag: string) => new El(tag), body, activeElement: null, addEventListener() {}, removeEventListener() {} };
  let onMessage: ((e: unknown) => void) | null = null;
  g.window = { addEventListener: (type: string, fn: (e: unknown) => void) => { if (type === 'message') onMessage = fn; }, removeEventListener() {} };
  try {
    const { openTryOn, POPUP_STYLE, SHOWN_MESSAGE } = await import('../src/tryon');
    const buttonRoot = new El('#shadow');
    openTryOn(buttonRoot as never, 'https://tajribah.com/embed/try-on?store=failet&product=244167095&lang=ar', 'ar', 'ساعة رجالية');
    assert.equal(buttonRoot.children.length, 0, 'not under the button: a store’s sticky column or header could draw over it there');
    const layer = body.children[0]!;
    assert.ok(layer.attrs.has('data-tajribah-popup') && layer.shadow, 'its own layer at the end of the page, isolated');
    const [style, overlay] = layer.shadow!.children as [El, El];
    assert.equal(style.textContent, POPUP_STYLE);
    assert.match(POPUP_STYLE, /\.tryon-sheet\{[^}]*width:min\(940px,100%\);height:min\(740px,100%\)/, 'a window, not the whole screen');
    assert.deepEqual([overlay.className, overlay.attrs.get('role'), overlay.attrs.get('aria-modal')], ['tryon', 'dialog', 'true']);
    const sheet = overlay.children[0]!;
    assert.equal(sheet.className, 'tryon-sheet');
    assert.deepEqual(sheet.children.map((c) => [c.tag, c.className]), [['iframe', ''], ['button', 'tryon-close']], 'the studio and our close button, in the window');
    assert.equal(sheet.children[0]!.src, 'https://tajribah.com/embed/try-on?store=failet&product=244167095&lang=ar&view=popup', 'the studio’s popup view: the shopper is on the product page already');
    assert.equal(body.style.overflow, 'hidden', 'the page behind does not scroll');
    const [frame, close] = sheet.children as [El, El];
    onMessage!({ origin: 'https://evil.example', source: frame.contentWindow, data: { type: SHOWN_MESSAGE } });
    onMessage!({ origin: 'https://tajribah.com', source: {}, data: { type: SHOWN_MESSAGE } });
    assert.notEqual(close.style.display, 'none', 'only our frame can say its page is up');
    onMessage!({ origin: 'https://tajribah.com', source: frame.contentWindow, data: { type: SHOWN_MESSAGE } });
    assert.equal(close.style.display, 'none', 'the studio’s own close is up: our backup close steps aside');
    overlay.fire('click', { target: sheet });
    assert.equal(body.children.length, 1, 'a tap inside the window keeps it open');
    overlay.fire('click', { target: overlay });
    assert.equal(body.children.length, 0, 'a tap outside closes it, layer and all');
    assert.equal(body.style.overflow, 'auto', 'and the page scrolls again');
  } finally {
    g.document = saved.document;
    g.window = saved.window;
  }
});

test('T100: the website’s and the widget’s frame messages are the same words', async () => {
  const site = await import('@site/lib/tryon-config');
  const widget = await import('../src/tryon');
  assert.equal(site.CLOSE_MESSAGE, widget.CLOSE_MESSAGE);
  assert.equal(site.SHOWN_MESSAGE, widget.SHOWN_MESSAGE);
});

test('T103: with the store’s cart, the window’s foot offers the product and «أضف للسلة» — the window closes, then the store’s own button', async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window };
  const body = new El('body');
  g.document = { createElement: (tag: string) => new El(tag), body, activeElement: null, addEventListener() {}, removeEventListener() {} };
  g.window = { addEventListener() {}, removeEventListener() {} };
  try {
    const { openTryOn } = await import('../src/tryon');
    const events: string[] = [];
    openTryOn(new El('#shadow') as never, 'https://tajribah.com/embed/try-on?store=failet&product=235186172&lang=ar', 'ar', 'ساعة رجالية', {
      name: 'ساعة رجالية فضي', price: '96 ر.س', add: () => { events.push(`added, popup open: ${body.children.length === 1}`); },
    });
    const sheet = body.children[0]!.shadow!.children[1]!.children[0]!;
    assert.equal(sheet.className, 'tryon-sheet with-cart');
    const foot = sheet.children[2]!;
    assert.equal(foot.className, 'tryon-cart');
    const [what, add] = foot.children as [El, El];
    assert.deepEqual(what.children.map((c) => [c.className, c.textContent]), [['tryon-cart-name', 'ساعة رجالية فضي'], ['tryon-cart-price', '96 ر.س']]);
    assert.equal(add.textContent, 'أضف للسلة');
    add.fire('click', {});
    assert.deepEqual(events, ['added, popup open: false'], 'the window is gone before the store’s own button is pressed: its cart and messages are seen');

    openTryOn(new El('#shadow') as never, 'https://tajribah.com/embed/try-on?store=failet&product=1&lang=en', 'en', 'Watch', { name: 'Watch', price: null, add() {} });
    const plain = body.children[0]!.shadow!.children[1]!.children[0]!;
    assert.deepEqual(plain.children[2]!.children[0]!.children.map((c) => c.className), ['tryon-cart-name'], 'no price read: the name alone');
    assert.equal(plain.children[2]!.children[1]!.textContent, 'Add to cart');
    body.children[0]!.remove();

    openTryOn(new El('#shadow') as never, 'https://tajribah.com/embed/try-on?store=failet&product=1&lang=ar', 'ar', 'Watch');
    const none = body.children[0]!.shadow!.children[1]!.children[0]!;
    assert.deepEqual([none.className, none.children.length], ['tryon-sheet', 2], 'no store cart (not a Salla page): no foot');
  } finally {
    g.document = saved.document;
    g.window = saved.window;
  }
});
