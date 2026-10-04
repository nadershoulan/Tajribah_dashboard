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
 *  - T74: or by a column (`sortValue`), empty values last either way, ties newest first.
 */
import { PRODUCT_FILTERS, type ProductFilter, type ProductListPage, type ProductListQuery, type ProductSort } from './contracts/products';
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

const MODEL_RANK: Record<ProductRow['modelStatus'], number | null> = { ready: 0, processing: 1, failed: 2, none: null };

/** What a column sorts by — the API's `sortKey`, rule for rule; null sorts last. */
export function sortValue(product: ProductRow, sort: ProductSort): string | number | null {
  switch (sort) {
    case 'name': return product.name.toLowerCase();
    case 'type': return product.productType;
    case 'category': return product.category?.name.toLowerCase() ?? null;
    case 'price': return product.priceMinor;
    case 'size': return isSized(product) ? product.dimensions!.widthMm! : null;
    case 'model': return MODEL_RANK[product.modelStatus];
    case 'ar': return product.live ? 0 : product.arEnabled ? 1 : 2;
    case 'views': return product.views30;
    case 'updated': return product.updatedAt;
  }
}

function byColumn(sort: ProductSort, dir: 'asc' | 'desc') {
  return (a: ProductRow, b: ProductRow): number => {
    const x = sortValue(a, sort), y = sortValue(b, sort);
    if (x === null || y === null) return x === y ? newest(a, b) : x === null ? 1 : -1;
    const order = x < y ? -1 : x > y ? 1 : 0;
    return order === 0 ? newest(a, b) : dir === 'desc' ? -order : order;
  };
}
const newest = (a: ProductRow, b: ProductRow) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

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
    .filter((p) => matchesFilter(p, filter) && (!query.category || p.category?.id === query.category) && (query.page || query.sort || !query.cursor || p.id < query.cursor))
    .sort(query.sort ? byColumn(query.sort, query.dir ?? 'asc') : newest);
  const start = query.page ? (query.page - 1) * limit : 0; // T73: a numbered page
  const page = ordered.slice(start, start + limit);
  const inCategory = searched.filter((p) => !query.category || p.category?.id === query.category); // T77
  const counts = Object.fromEntries(PRODUCT_FILTERS.map((f) => [f, inCategory.filter((p) => matchesFilter(p, f)).length])) as Record<ProductFilter, number>;
  return { rows: page, counts, nextCursor: ordered.length > start + limit ? page[page.length - 1].id : null };
}

export type ProductSortState = { by: ProductSort; dir: 'asc' | 'desc' } | null;
/** T74: numbers people want biggest or latest first start descending; words and states start ascending. */
const FIRST_DIR: Record<ProductSort, 'asc' | 'desc'> = { name: 'asc', type: 'asc', category: 'asc', price: 'desc', size: 'desc', model: 'asc', ar: 'asc', views: 'desc', updated: 'desc' };
/** Click: that column, its first direction → the other direction → back to newest first. */
export function nextSort(current: ProductSortState, by: ProductSort): ProductSortState {
  if (current?.by !== by) return { by, dir: FIRST_DIR[by] };
  return current.dir === FIRST_DIR[by] ? { by, dir: current.dir === 'asc' ? 'desc' : 'asc' } : null;
}
