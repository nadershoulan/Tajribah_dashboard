/**
 * P1.17 — what a merchant pastes into their product page template, built from the same
 * attribute names the widget reads (`ATTR`), so the two cannot drift apart.
 *
 * `{{ product.id }}` is the theme's placeholder for the product on the page; the install
 * checker flags a page where it was pasted but never filled in. The exact template syntax for
 * Salla and Zid is confirmed with the partner apps (P1.4 🔒).
 */
import { ATTR, WIDGET_SRC } from './main';

export const PRODUCT_PLACEHOLDER = '{{ product.id }}';

export function embedSnippet(storeKey: string, productRef = PRODUCT_PLACEHOLDER): string {
  const safe = storeKey.replace(/[^a-z0-9-]/gi, '');
  return [
    `<div ${ATTR.product}="${productRef}"></div>`,
    `<script src="${WIDGET_SRC}" ${ATTR.store}="${safe}" async></script>`,
  ].join('\n');
}
