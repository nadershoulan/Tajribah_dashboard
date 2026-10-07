/**
 * T95 — the widget placing itself, for a store that adds it once to every page instead of to its product
 * template: Google Tag Manager, linked from Salla's own "Google Tags Manager" app, runs one tag on every
 * page and has no `{{ product.id }}` to fill in. With `data-tajribah-auto="salla"` on the script, the
 * widget finds both halves of the placeholder itself:
 *
 *  - **Which product.** A Salla product address ends in `/p` and Salla's number for the product
 *    (`/ar/<the name>/p1412564664`), whatever the language or the theme. A published product whose feed
 *    gave its page's address is also published under that number (`page:p1412564664`, see
 *    `server/modules/edge/build.ts`), so the number finds its config. Any other page (the home page, a
 *    category, the cart) has no number: nothing is placed and nothing is fetched.
 *  - **Where.** The owner's own spot when they name one (`data-tajribah-anchor`, a CSS selector: the
 *    button goes right after it). Else (T100) under the product's picture — Salla's gallery
 *    (`salla-slider#details-slider-<number>`), centred — or, with `data-tajribah-spot="options"`, right after
 *    Salla's product-form hook (under the options, above the add-to-cart bar); either falls back to the
 *    other, then to just before the add-to-cart button. No spot: nothing is placed.
 *
 * What is placed is an empty box; the button is drawn in it only when the product is published, so a
 * product that is not changes nothing on the page.
 */

/** Refs made from a store page's address start with this, so they can never be mistaken for a product's own id. */
export const PAGE_REF_PREFIX = 'page:';

/** The platforms whose product pages the widget can read. */
export type AutoPlatform = 'salla';
export const autoPlatformOf = (value: string | null | undefined): AutoPlatform | null => (value === 'salla' ? 'salla' : null);

/** Salla's product address: `/p` and the product's number, last in the path (a trailing slash allowed). */
const SALLA_PRODUCT = /\/p(\d{3,20})\/?$/;

/** The ref a Salla product page is published under (`page:p1412564664`), or null for any other address. */
export function pageRefOf(url: string): string | null {
  try {
    const match = SALLA_PRODUCT.exec(new URL(url).pathname);
    return match ? `${PAGE_REF_PREFIX}p${match[1]}` : null;
  } catch {
    return null;
  }
}

type Where = 'afterend' | 'beforebegin';

/** T100: the two places an owner chooses between — under the product's picture (the default), or under its options. */
export type ButtonSpot = 'image' | 'options';
export const spotOf = (value: string | null | undefined): ButtonSpot => (value === 'options' ? 'options' : 'image');

type Place = { selector: string; where: Where; centred?: boolean };
const GALLERY: Place = { selector: 'salla-slider[id^="details-slider-"]', where: 'afterend', centred: true };
const OPTIONS: Place = { selector: 'salla-hook[name="product:single.form.end"]', where: 'afterend' };
const CART: Place = { selector: 'salla-add-product-button', where: 'beforebegin' };

/** Where the button goes on a Salla product page, in order of preference, for each choice. Every Salla theme renders these. */
export const SALLA_SPOTS: Readonly<Record<ButtonSpot, readonly Place[]>> = {
  image: [GALLERY, OPTIONS, CART],
  options: [OPTIONS, GALLERY, CART],
};

/** Just enough of a document (a test passes a fake). */
type Spot = { insertAdjacentElement(where: Where, element: never): unknown };
type Box = { setAttribute(name: string, value: string): void; style: { margin: string; display: string; justifyContent: string } };
export type PageDocument = {
  querySelector(selector: string): unknown;
  createElement(tag: 'div'): Box;
};

export type Placed = 'placed' | 'not_a_product_page' | 'already_there' | 'no_spot';

/**
 * Put the empty box for this page's product in its spot. `productAttr` is the attribute the widget
 * mounts (`ATTR.product`). Never throws: a selector the owner mistyped counts as no spot of theirs.
 */
export function placeOnPage(doc: PageDocument, pageUrl: string, productAttr: string, anchor: string | null, choice: ButtonSpot = 'image'): Placed {
  if (doc.querySelector(`[${productAttr}]`)) return 'already_there'; // the theme's own placeholder, or one placed before
  const ref = pageRefOf(pageUrl);
  if (!ref) return 'not_a_product_page';
  const spots: Place[] = anchor ? [{ selector: anchor, where: 'afterend' }, ...SALLA_SPOTS[choice]] : [...SALLA_SPOTS[choice]];
  for (const { selector, where, centred } of spots) {
    let spot: Spot | null = null;
    try { spot = doc.querySelector(selector) as Spot | null; } catch { /* not a valid selector */ }
    if (!spot) continue;
    const box = doc.createElement('div');
    box.setAttribute(productAttr, ref);
    box.style.margin = '12px 0';
    if (centred) { box.style.display = 'flex'; box.style.justifyContent = 'center'; } // under a picture: in its middle
    spot.insertAdjacentElement(where, box as never);
    return 'placed';
  }
  return 'no_spot';
}

/** How long a theme that draws its product form late is waited for: tries × the gap between them. */
export const PLACE_TRIES = 20;
export const PLACE_GAP_MS = 500;
