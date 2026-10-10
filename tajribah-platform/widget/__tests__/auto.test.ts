/**
 * T95 — the widget placing itself on a Salla product page, for a store that adds it once through Google Tag
 * Manager: the product from the page's address, the spot from Salla's own markup, nothing anywhere else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoPlatformOf, pageRefOf, placeOnPage, priceText, sallaCartOf, SALLA_SPOTS, spotOf, type PageDocument } from '../src/auto';
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
  type Recorded = { at: string; where: string; attrs: Record<string, string>; margin: string; centred: boolean };
  const inserted: Recorded[] = [];
  const doc: PageDocument = {
    querySelector(selector: string) {
      if (selector === options.throwsOn) throw new SyntaxError('not a valid selector');
      if (selector === `[${ATTR.product}]`) return options.placeholder || inserted.length ? {} : null;
      if (!present.includes(selector)) return null;
      return { insertAdjacentElement: (where: string, box: { attrs: Record<string, string>; style: { margin: string; display: string; justifyContent: string } }) => {
        inserted.push({ at: selector, where, attrs: box.attrs, margin: box.style.margin, centred: box.style.display === 'flex' && box.style.justifyContent === 'center' });
      } };
    },
    createElement: () => {
      const attrs: Record<string, string> = {};
      return { attrs, style: { margin: '', display: '', justifyContent: '' }, setAttribute: (name: string, value: string) => { attrs[name] = value; } };
    },
  };
  return { doc, inserted };
}

const GALLERY = 'salla-slider[id^="details-slider-"]';
const HOOK = 'salla-hook[name="product:single.form.end"]';
const CART = 'salla-add-product-button';

test('T100: by default the box goes under the product’s picture, centred; else under the options, else before add-to-cart, else nowhere', () => {
  assert.deepEqual(SALLA_SPOTS.image.map((s) => s.selector), [GALLERY, HOOK, CART]);
  const full = page([GALLERY, HOOK, CART]);
  assert.equal(placeOnPage(full.doc, SILVER_WATCH, ATTR.product, null), 'placed');
  assert.deepEqual(full.inserted, [{ at: GALLERY, where: 'afterend', attrs: { [ATTR.product]: 'page:p1412564664' }, margin: '12px 0', centred: true }]);
  assert.equal(placeOnPage(full.doc, SILVER_WATCH, ATTR.product, null), 'already_there', 'placed once: a second run (a refresh) adds nothing');
  assert.equal(full.inserted.length, 1);

  const noGallery = page([HOOK, CART]);
  assert.equal(placeOnPage(noGallery.doc, BLACK_WATCH, ATTR.product, null), 'placed');
  assert.deepEqual([noGallery.inserted[0]!.at, noGallery.inserted[0]!.centred], [HOOK, false], 'a theme without the gallery: under the options, not centred');

  const cartOnly = page([CART]);
  assert.equal(placeOnPage(cartOnly.doc, BLACK_WATCH, ATTR.product, null), 'placed');
  assert.deepEqual([cartOnly.inserted[0]!.at, cartOnly.inserted[0]!.where, cartOnly.inserted[0]!.attrs[ATTR.product]], [CART, 'beforebegin', 'page:p2114755498']);

  const bare = page([]);
  assert.equal(placeOnPage(bare.doc, BLACK_WATCH, ATTR.product, null), 'no_spot');
  assert.equal(bare.inserted.length, 0);
});

test('T100: the owner may choose under the options instead — the picture is then the fallback', () => {
  assert.equal(spotOf('options'), 'options');
  for (const other of [null, undefined, '', 'image', 'gallery', 'OPTIONS']) assert.equal(spotOf(other), 'image', String(other));
  const full = page([GALLERY, HOOK, CART]);
  assert.equal(placeOnPage(full.doc, SILVER_WATCH, ATTR.product, null, 'options'), 'placed');
  assert.deepEqual([full.inserted[0]!.at, full.inserted[0]!.centred], [HOOK, false]);
  const noHook = page([GALLERY, CART]);
  placeOnPage(noHook.doc, SILVER_WATCH, ATTR.product, null, 'options');
  assert.equal(noHook.inserted[0]!.at, GALLERY);
});

test('the owner’s own spot comes first; a mistyped one falls back to Salla’s; other pages and themed pages are left alone', () => {
  const own = page(['.product-price', GALLERY]);
  assert.equal(placeOnPage(own.doc, BRACELET, ATTR.product, '.product-price'), 'placed');
  assert.deepEqual([own.inserted[0]!.at, own.inserted[0]!.where, own.inserted[0]!.centred], ['.product-price', 'afterend', false]);

  const typo = page([GALLERY], { throwsOn: '.price[' });
  assert.equal(placeOnPage(typo.doc, BRACELET, ATTR.product, '.price['), 'placed', 'never throws on the owner’s selector');
  assert.equal(typo.inserted[0]!.at, GALLERY);

  const home = page([GALLERY, HOOK]);
  assert.equal(placeOnPage(home.doc, 'https://failet.sa/ar', ATTR.product, null), 'not_a_product_page');
  assert.equal(home.inserted.length, 0, 'nothing on a page that is not a product’s');

  const themed = page([GALLERY], { placeholder: true });
  assert.equal(placeOnPage(themed.doc, BRACELET, ATTR.product, null), 'already_there', 'a theme that has its own placeholder keeps it');
  assert.equal(themed.inserted.length, 0);
});

test('the Tag Manager tag: our script, this store, self-placing — the owner’s spot cannot break out of its attribute', () => {
  // T125: Tag Manager keeps only the script's src, so everything the tag says is in its address
  const tag = tagManagerSnippet('failet');
  assert.equal(tag, `<script src="${WIDGET_SRC}?store=failet&amp;auto=salla" async></script>`);
  assert.ok(!tag.includes(ATTR.store), 'no data- attributes: Tag Manager would drop them');
  assert.equal(autoPlatformOf('salla'), 'salla');
  assert.equal(autoPlatformOf('zid'), null, 'a platform the widget cannot read is not guessed at');
  assert.ok(tagManagerSnippet('failet', { consent: true }).includes('&amp;consent=required"'));
  const spot = tagManagerSnippet('failet', { anchor: '.price"><script>alert(1)</script>' });
  assert.ok(!spot.includes('"><script>alert'), spot);
  assert.ok(spot.includes('&amp;anchor=.pricescriptalert(1)%2Fscript"'), spot);
  assert.ok(!tagManagerSnippet('failet', { anchor: '   ' }).includes('anchor='), 'an empty spot is left out');
  // T100: under the picture is the default, so only the other choice is written
  assert.ok(!tagManagerSnippet('failet', { spot: 'image' }).includes('spot='));
  assert.ok(tagManagerSnippet('failet', { spot: 'options' }).includes('&amp;spot=options'));
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
    const drawn = await mount(doc as never, { store: 'failet', configBase: 'https://cfg.example.test/v1', viewer: '', events: '', consent: 'granted', tryon: 'https://tajribah.org/embed/try-on' },
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

test('T103: the store’s own add-to-cart for the page’s product — the main button, its price and the store’s currency', () => {
  const clicks: string[] = [];
  const button = (id: string, inCard: boolean, amount: string | null) => ({
    closest: (selector: string) => (inCard && /product-card/.test(selector) ? {} : null),
    getAttribute: (name: string) => (name === 'amount' ? amount : name === 'product-id' ? id : null),
    querySelector: (selector: string) => (selector === 'button' ? { click: () => { clicks.push(`inner ${id}`); } } : null),
    click: () => { clicks.push(`host ${id}`); },
  });
  const doc = (buttons: ReturnType<typeof button>[]) => ({
    querySelectorAll: (selector: string) => buttons.filter((b) => selector === `salla-add-product-button[product-id="${b.getAttribute('product-id')}"]`),
  });
  const salla = { salla: { config: { get: (key: string) => (key === 'user.currency_code' ? 'SAR' : null) } } };

  const page = doc([button('1713032054', true, null), button('1713032054', false, '96'), button('2132822355', true, null)]);
  const cart = sallaCartOf(page, 'page:p1713032054', salla)!;
  assert.deepEqual([cart.price, cart.currency], [96, 'SAR'], 'the product’s own button — not the same product’s card further down');
  cart.add();
  assert.deepEqual(clicks, ['inner 1713032054'], 'the store’s own button is pressed: its options, cart and messages are Salla’s');

  assert.equal(sallaCartOf(doc([button('1713032054', true, null)]), 'page:p1713032054', salla), null, 'only in a product card: not this page’s button');
  assert.equal(sallaCartOf(page, '244167095', salla), null, 'a product not found by its page');
  assert.deepEqual([sallaCartOf(page, 'page:p1713032054', {})!.currency, sallaCartOf(doc([button('9', false, 'abc')]), 'page:p9', salla)!.price], [null, null], 'no currency, or no readable price: none shown');
  assert.equal(sallaCartOf(page, 'page:p1713032054', { salla: { config: { get: () => { throw new Error('x'); } } } })!.currency, null, 'never throws');

  assert.match(priceText(96, 'SAR', 'ar'), /96/);
  assert.match(priceText(196.01, 'SAR', 'ar'), /196\.01\sر\.س/, 'Western digits in Arabic, as the dashboard writes them');
  assert.ok(!/[٠-٩]/.test(priceText(196.01, 'SAR', 'ar')));
  assert.match(priceText(96, 'SAR', 'en'), /^SAR\s96$/);
});
