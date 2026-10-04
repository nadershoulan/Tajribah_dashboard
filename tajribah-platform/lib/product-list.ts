/**
 * P1.9 — the catalogue list rules, for the places that answer without the API: the demo
 * source behind the static preview. The API (server/modules/products/service.ts) is the
 * authority; these mirror it rule for rule, and `lib/__tests__/product-list.test.ts` pins
 * each rule so the preview cannot quietly drift from what a real store would see.
 *
 *  - Archived products appear in no filter except by search-free omission; `draft` is its own.
 *  - "Sized" means width **and** height in millimetres — the rule that gates AR.
 *  - Search matches name, Arabic name or SKU, case-insensitively, as plain text.
 *  - Newest first by id; the cursor is the last id of the previous page.
 */
import { PRODUCT_FILTERS, type ProductFilter, type ProductListPage, type ProductListQuery } from './contracts/products';
import type { ProductRow } from './view-models';

export const isSized = (product: Pick<ProductRow, 'dimensions'>): boolean =>
  !!(product.dimensions?.widthMm && product.dimensions?.heightMm);

export function matchesFilter(product: ProductRow, filter: ProductFilter): boolean {
  const live = product.status !== 'archived';
  switch (filter) {
    case 'all': return live;
    case 'ar_on': return live && product.arEnabled;
    case 'no_ar': return live && !product.arEnabled;
    case 'missing_sizes': return live && !isSized(product);
    case 'draft': return product.status === 'draft';
  }
}

export function matchesSearch(product: ProductRow, q: string | undefined): boolean {
  const text = q?.trim().toLowerCase();
  if (!text) return true;
  return [product.name, product.nameAr ?? '', product.sku ?? ''].some((field) => field.toLowerCase().includes(text));
}

export function pageOf(rows: readonly ProductRow[], query: Partial<ProductListQuery>): ProductListPage {
  const filter = query.filter ?? 'all';
  const limit = query.limit ?? 50;
  const searched = rows.filter((p) => matchesSearch(p, query.q));
  const ordered = searched
    .filter((p) => matchesFilter(p, filter) && (query.page || !query.cursor || p.id < query.cursor))
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const start = query.page ? (query.page - 1) * limit : 0; // T73: a numbered page
  const page = ordered.slice(start, start + limit);
  const counts = Object.fromEntries(PRODUCT_FILTERS.map((f) => [f, searched.filter((p) => matchesFilter(p, f)).length])) as Record<ProductFilter, number>;
  return { rows: page, counts, nextCursor: ordered.length > start + limit ? page[page.length - 1].id : null };
}
