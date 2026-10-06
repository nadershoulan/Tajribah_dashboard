/**
 * T95 — the widget placing itself on a Salla product page, for a store that adds it once through Google Tag
 * Manager: the product from the page's address, the spot from Salla's own markup, nothing anywhere else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoPlatformOf, pageRefOf, placeOnPage, SALLA_SPOTS, type PageDocument } from '../src/auto';
import { parseConfig } from '../src/config';
import { ATTR, WIDGET_SRC } from '../src/main';
import { tagManagerSnippet } from '../src/snippet';
import { GOOD } from './fixtures';

// Failet's own product addresses, as the owner sent them
const BRACELET = 'https://failet.sa/ar/%D8%A7%D8%B3%D9%88%D8%A7%D8%B1%D9%87-%D8%B2%D8%B1%D9%83%D9%88%D9%86-%D8%B0%D9%87%D8%A8%D9%8A-%D9%81%D8%A7%D9%8A%D9%84%D8%AA-%D9%85%D8%AC%D9%88%D9%87%D8%B1%D8%A7%D8%AA-%D9%81%D8%A7%D8%AE%D8%B1%D8%A9/p2132822355';
const BLACK_WATCH = 'https://failet.sa/ar/%D8%B3%D8%A7%D8%B9%D8%A9-%D8%B1%D8%AC%D8%A7%D9%84%D9%8A%D8%A9-%D8%A7%D8%B3%D9%88%D8%AF-%D9%85%D9%8A%D9%86%D8%A7-%D8%A7%D8%B3%D9%88%D8%AF-%D8%B3%D8%A7%D9%86-%D9%84%D9%88%D8%B1%D9%8A%D8%B3/p2114755498';
const SILVER_WATCH = 'https://failet.sa/ar/%D8%B3%D8%A7%D8%B9%D8%A9-%D8%B1%D8%AC%D8%A7%D9%84%D9%8A%D8%A9-%D9%81%D8%B6%D9%8A-%D9%85%D9%8A%D9%86%D8%A7-%D8%B1%D9%85%D8%A7%D8%AF%D9%8A/p1412564664';

test('a Salla product page is named by its number, in any language; every other page is not a product', () => {
  assert.equal(pageRefOf(BRACELET), 'page:p2132822355');
  assert.equal(pageRefOf(BLACK_WATCH), 'page:p2114755498');
  assert.equal(pageRefOf(SILVER_WATCH), 'page:p1412564664');
  assert.equal(pageRefOf('https://failet.sa/en/silver-watch/p1412564664'), 'page:p1412564664', 'the English page is the same product');
  assert.equal(pageRefOf('https://failet.sa/ساعة/p1412564664/?utm_source=x#reviews'), 'page:p1412564664', 'a slash, a query or a fragment after it');
  for (const other of ['https://failet.sa/ar', 'https://failet.sa/ar/', 'https://failet.sa/ar/c123456', 'https://failet.sa/ar/cart', 'https://failet.sa/ar/p12',
    'https://failet.sa/ar/p1412564664/reviews', 'https://failet.sa/ar/shop?p=1412564664', 'https://failet.sa/ar/xp1412564664', 'not a url']) {
    assert.equal(pageRefOf(other), null, other);
  }
});

/** A page as the placer sees it: elements by selector, each recording what was put beside it. */
function page(present: string[], options: { placeholder?: boolean; throwsOn?: string } = {}) {
  const inserted: { at: string; where: string; attrs: Record<string, string>; margin: string }[] = [];
  const doc: PageDocument = {
    querySelector(selector: string) {
      if (selector === options.throwsOn) throw new SyntaxError('not a valid selector');
      if (selector === `[${ATTR.product}]`) return options.placeholder || inserted.length ? {} : null;
      if (!present.includes(selector)) return null;
      return { insertAdjacentElement: (where: string, box: { attrs: Record<string, string>; style: { margin: string } }) => { inserted.push({ at: selector, where, attrs: box.attrs, margin: box.style.margin }); } };
    },
    createElement: () => {
      const attrs: Record<string, string> = {};
      return { attrs, style: { margin: '' }, setAttribute: (name: string, value: string) => { attrs[name] = value; } };
    },
  };
  return { doc, inserted };
}

test('the box goes after Salla’s product-form hook, else before the add-to-cart button, else nowhere', () => {
  const [hook, cart] = SALLA_SPOTS.map((s) => s.selector);
  const full = page([hook!, cart!]);
  assert.equal(placeOnPage(full.doc, SILVER_WATCH, ATTR.product, null), 'placed');
  assert.deepEqual(full.inserted, [{ at: hook, where: 'afterend', attrs: { [ATTR.product]: 'page:p1412564664' }, margin: '12px 0' }]);
  assert.equal(placeOnPage(full.doc, SILVER_WATCH, ATTR.product, null), 'already_there', 'placed once: a second run (a refresh) adds nothing');
  assert.equal(full.inserted.length, 1);

  const noHook = page([cart!]);
  assert.equal(placeOnPage(noHook.doc, BLACK_WATCH, ATTR.product, null), 'placed');
  assert.deepEqual([noHook.inserted[0]!.at, noHook.inserted[0]!.where, noHook.inserted[0]!.attrs[ATTR.product]], [cart, 'beforebegin', 'page:p2114755498']);

  const bare = page([]);
  assert.equal(placeOnPage(bare.doc, BLACK_WATCH, ATTR.product, null), 'no_spot');
  assert.equal(bare.inserted.length, 0);
});

test('the owner’s own spot comes first; a mistyped one falls back to Salla’s; other pages and themed pages are left alone', () => {
  const [hook] = SALLA_SPOTS.map((s) => s.selector);
  const own = page(['.product-price', hook!]);
  assert.equal(placeOnPage(own.doc, BRACELET, ATTR.product, '.product-price'), 'placed');
  assert.deepEqual([own.inserted[0]!.at, own.inserted[0]!.where], ['.product-price', 'afterend']);

  const typo = page([hook!], { throwsOn: '.price[' });
  assert.equal(placeOnPage(typo.doc, BRACELET, ATTR.product, '.price['), 'placed', 'never throws on the owner’s selector');
  assert.equal(typo.inserted[0]!.at, hook);

  const home = page([hook!]);
  assert.equal(placeOnPage(home.doc, 'https://failet.sa/ar', ATTR.product, null), 'not_a_product_page');
  assert.equal(home.inserted.length, 0, 'nothing on a page that is not a product’s');

  const themed = page([hook!], { placeholder: true });
  assert.equal(placeOnPage(themed.doc, BRACELET, ATTR.product, null), 'already_there', 'a theme that has its own placeholder keeps it');
  assert.equal(themed.inserted.length, 0);
});

test('the Tag Manager tag: our script, this store, self-placing — the owner’s spot cannot break out of its attribute', () => {
  const tag = tagManagerSnippet('failet');
  assert.equal(tag, `<script src="${WIDGET_SRC}" ${ATTR.store}="failet" ${ATTR.auto}="salla" async></script>`);
  assert.equal(autoPlatformOf('salla'), 'salla');
  assert.equal(autoPlatformOf('zid'), null, 'a platform the widget cannot read is not guessed at');
  assert.ok(tagManagerSnippet('failet', { consent: true }).includes(`${ATTR.consent}="required"`));
  const spot = tagManagerSnippet('failet', { anchor: '.price"><script>alert(1)</script>' });
  assert.ok(!spot.includes('"><script>alert'), spot);
  assert.ok(spot.includes(`${ATTR.anchor}=".pricescriptalert(1)/script"`), spot);
  assert.ok(!tagManagerSnippet('failet', { anchor: '   ' }).includes(ATTR.anchor), 'an empty spot is left out');
});

/** Just enough of an element for `renderButton` and `mount` (no DOM library in these tests). */
class FakeElement {
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  shadowRoot: FakeElement | null = null;
  children: FakeElement[] = [];
  textContent = ''; type = ''; dir = ''; className = '';
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string) { this.attrs.set(name, String(value)); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string) { return this.attrs.has(name); }
  attachShadow() { this.shadowRoot = new FakeElement('#shadow'); return this.shadowRoot; }
  set innerHTML(_html: string) { this.children = []; }
  appendChild(child: FakeElement) { this.children.push(child); return child; }
  insertAdjacentHTML() { /* the icon */ }
  addEventListener() { /* the tap */ }
}

test('found by its page, the product is reported under its own ref — the one the dashboard counts', async () => {
  const host = new FakeElement('div');
  host.setAttribute(ATTR.product, 'page:p1412564664');
  const doc = {
    documentElement: { getAttribute: () => 'ar' },
    querySelectorAll: () => [host],
    head: { querySelector: () => null, appendChild: () => undefined },
    createElement: (tag: string) => new FakeElement(tag),
  };
  const asked: string[] = [];
  const events: { type: string; productId?: string }[] = [];
  const realDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: (tag: string) => new FakeElement(tag) };
  try {
    const { mount } = await import('../src/main');
    const drawn = await mount(doc as never, { store: 'failet', configBase: 'https://cfg.example.test/v1', viewer: '', events: '', consent: 'granted', tryon: 'https://tajribah.com/embed/try-on' },
      (async (url: string) => { asked.push(String(url)); return Response.json({ ...GOOD, ref: '244167095' }); }) as typeof fetch,
      { track: (e: { type: string; productId?: string }) => { events.push(e); } } as never);
    assert.equal(drawn, 1);
    assert.deepEqual(asked, ['https://cfg.example.test/v1/failet/page%3Ap1412564664.json'], 'the config is asked for at the page’s ref');
    assert.deepEqual(events.map((e) => [e.type, e.productId]), [['product_view', '244167095']]);
  } finally {
    (globalThis as { document?: unknown }).document = realDocument;
  }
});

test('a config may name the product’s own ref (found by its page); anything but a short string is ignored', () => {
  assert.equal(parseConfig(GOOD)?.ref, null);
  assert.equal(parseConfig({ ...GOOD, ref: '244167095' })?.ref, '244167095');
  for (const junk of [7, '', 'x'.repeat(201), { id: 1 }, null]) assert.equal(parseConfig({ ...GOOD, ref: junk })?.ref, null, JSON.stringify(junk));
});
