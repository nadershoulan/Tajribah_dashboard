import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSized, pageOf } from '@/lib/product-list';
import { DEMO_PRODUCTS } from '@/lib/demo-data';
import type { ProductRow } from '@/lib/view-models';

const row = (id: string, over: Partial<ProductRow> = {}): ProductRow => ({
  id, name: `Product ${id}`, nameAr: null, sku: null, imageUrl: null, priceMinor: null, currency: 'SAR',
  productType: 'other', status: 'active', arEnabled: false, tryonEnabled: false, modelStatus: 'none',
  dimensions: null, views30: 0, arSessions30: 0, updatedAt: '2026-09-01T00:00:00Z', ...over,
});

test('sized means width AND height — the same rule that gates AR on the server', () => {
  assert.equal(isSized(row('a', { dimensions: { widthMm: 40, heightMm: 48 } })), true);
  assert.equal(isSized(row('a', { dimensions: { widthMm: 40 } })), false);
  assert.equal(isSized(row('a', { dimensions: { caseMm: 41 } })), false, 'a case size alone does not size the model');
  assert.equal(isSized(row('a')), false);
});

test('filters and counts mirror the API: archived only leaves the lists, draft is its own', () => {
  const rows = [
    row('01', { arEnabled: true, dimensions: { widthMm: 1, heightMm: 1 } }),
    row('02'),
    row('03', { status: 'draft' }),
    row('04', { status: 'archived', arEnabled: true }),
  ];
  const page = pageOf(rows, {});
  assert.deepEqual(page.counts, { all: 3, ar_on: 1, no_ar: 2, missing_sizes: 2, draft: 1 });
  assert.deepEqual(page.rows.map((r) => r.id), ['03', '02', '01'], 'newest id first, archived hidden');
  assert.deepEqual(pageOf(rows, { filter: 'missing_sizes' }).rows.map((r) => r.id), ['03', '02']);
});

test('search: name, Arabic name or SKU, any case, as plain text; counts follow the search', () => {
  const rows = [
    row('1', { name: 'Oyster 41', sku: 'OY-41' }),
    row('2', { name: 'Bag', nameAr: 'حقيبة جلد' }),
    row('3', { name: '100% silk', sku: 'S_1' }),
  ];
  assert.deepEqual(pageOf(rows, { q: 'oy-4' }).rows.map((r) => r.id), ['1']);
  assert.deepEqual(pageOf(rows, { q: 'OYSTER' }).rows.map((r) => r.id), ['1'], 'upper-case query, mixed-case name');
  assert.deepEqual(pageOf(rows, { q: 'جلد' }).rows.map((r) => r.id), ['2']);
  assert.deepEqual(pageOf(rows, { q: '%' }).rows.map((r) => r.id), ['3'], '% is a character, not a wildcard');
  assert.deepEqual(pageOf(rows, { q: '_' }).rows.map((r) => r.id), ['3']);
  assert.equal(pageOf(rows, { q: 'oyster' }).counts.all, 1);
});

test('paging by cursor neither skips nor repeats', () => {
  const rows = Array.from({ length: 23 }, (_, i) => row(String(i).padStart(3, '0')));
  const seen: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = pageOf(rows, { limit: 10, cursor });
    seen.push(...page.rows.map((r) => r.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  assert.equal(seen.length, 23);
  assert.equal(new Set(seen).size, 23);
});

test('the demo catalogue answers through the same rules', () => {
  const page = pageOf(DEMO_PRODUCTS, {});
  assert.equal(page.counts.all, DEMO_PRODUCTS.filter((p) => p.status !== 'archived').length);
});
