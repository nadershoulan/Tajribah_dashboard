/**
 * T73 — numbered pages, the same on every list: the first 3, the last 3, and the current one with its
 * neighbours; a gap ("…") stands for the pages left out. A gap of one page is that page instead —
 * "…" hiding a single number saves nothing.
 *
 *   pageItems(1, 20)  → 1 2 3 … 18 19 20
 *   pageItems(10, 20) → 1 2 3 … 9 10 11 … 18 19 20
 *   pageItems(4, 20)  → 1 2 3 4 5 … 18 19 20
 */
import { formatNumber } from './format';
import type { Lang } from './lang';

export type PageItem = number | 'gap';

export const EDGE_PAGES = 3;

export function pageItems(current: number, total: number): PageItem[] {
  if (total <= 0) return [];
  const page = Math.min(Math.max(1, Math.floor(current)), total);
  const shown = new Set<number>();
  for (let i = 1; i <= Math.min(EDGE_PAGES, total); i++) shown.add(i);
  for (let i = Math.max(1, total - EDGE_PAGES + 1); i <= total; i++) shown.add(i);
  for (let i = page - 1; i <= page + 1; i++) if (i >= 1 && i <= total) shown.add(i);
  const sorted = [...shown].sort((a, b) => a - b);
  const items: PageItem[] = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && n - prev === 2) items.push(prev + 1);
    else if (prev !== undefined && n - prev > 2) items.push('gap');
    items.push(n);
  });
  return items;
}

/** How many pages `count` rows make at `pageSize` a page (at least 1, so an empty list is page 1 of 1). */
export function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize));
}

/** One page of an array already in hand (a list the server sends whole). */
export function slicePage<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const p = Math.min(Math.max(1, page), pageCount(rows.length, pageSize));
  return rows.slice((p - 1) * pageSize, p * pageSize);
}

/** "51–100 من 1,243" — which rows a page shows, of how many. */
export function rangeText(page: number, pageSize: number, shown: number, total: number, lang: Lang): string {
  const n = (v: number) => formatNumber(v, lang);
  if (shown === 0) return lang === 'ar' ? `0 من ${n(total)}` : `0 of ${n(total)}`;
  const from = (page - 1) * pageSize + 1;
  const range = `${n(from)}–${n(from + shown - 1)}`;
  return lang === 'ar' ? `${range} من ${n(total)}` : `${range} of ${n(total)}`;
}
