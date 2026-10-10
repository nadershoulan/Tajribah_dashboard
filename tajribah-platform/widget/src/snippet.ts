/**
 * P1.17 — what a merchant pastes into their product page template, built from the same
 * attribute names the widget reads (`ATTR`), so the two cannot drift apart.
 *
 * `{{ product.id }}` is the theme's placeholder for the product on the page; the install
 * checker flags a page where it was pasted but never filled in. The exact template syntax for
 * Salla and Zid is confirmed with the partner apps (P1.4 🔒).
 */
import { ATTR, WIDGET_SRC } from './main';
import type { ButtonSpot } from './auto';

export const PRODUCT_PLACEHOLDER = '{{ product.id }}';

/**
 * `consent` (T48): the shop asks shoppers for consent first — nothing is measured until its banner
 * grants it (`CONSENT_LINE` in main.ts).
 */
/**
 * T95 — the tag a Salla store adds in Google Tag Manager (Custom HTML, fired on all pages): the script
 * alone, told to find the product and the button's spot on each page (`auto.ts`). It does nothing on a
 * page that is not a product's, and draws nothing for a product that is not published.
 */
export function tagManagerSnippet(storeKey: string, options: { consent?: boolean; anchor?: string; spot?: ButtonSpot } = {}): string {
  const safe = storeKey.replace(/[^a-z0-9-]/gi, '');
  // the owner's own spot (a CSS selector): quotes and angle brackets would end the attribute, so they go
  const spot = options.anchor?.replace(/["<>&]/g, '').trim().slice(0, 200);
  // T125: Google Tag Manager keeps a Custom HTML script's src and drops its data- attributes, so through Tag
  // Manager the settings ride in the address (the widget reads either). `&amp;` is how HTML writes "&".
  const query = [
    `store=${safe}`, 'auto=salla',
    // T100: under the picture is the default, so only the other choice is written
    ...(options.spot === 'options' ? ['spot=options'] : []),
    ...(spot ? [`anchor=${encodeURIComponent(spot)}`] : []),
    ...(options.consent ? ['consent=required'] : []),
  ].join('&amp;');
  return `<script src="${WIDGET_SRC}?${query}" async></script>`;
}

export function embedSnippet(storeKey: string, productRef = PRODUCT_PLACEHOLDER, options: { consent?: boolean } = {}): string {
  const safe = storeKey.replace(/[^a-z0-9-]/gi, '');
  const consent = options.consent ? ` ${ATTR.consent}="required"` : '';
  return [
    `<div ${ATTR.product}="${productRef}"></div>`,
    `<script src="${WIDGET_SRC}" ${ATTR.store}="${safe}"${consent} async></script>`,
  ].join('\n');
}
