/** T73: numbered pages — the first 3, the last 3, the current one and its neighbours. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageCount, pageItems, rangeText, slicePage } from '@/lib/pagination';

const show = (current: number, total: number) => pageItems(current, total).map((i) => (i === 'gap' ? '…' : String(i))).join(' ');

test('the first 3 and the last 3, with the current page and its neighbours between', () => {
  assert.equal(show(1, 20), '1 2 3 … 18 19 20');
  assert.equal(show(10, 20), '1 2 3 … 9 10 11 … 18 19 20');
  assert.equal(show(20, 20), '1 2 3 … 18 19 20');
  assert.equal(show(4, 20), '1 2 3 4 5 … 18 19 20');
  assert.equal(show(17, 20), '1 2 3 … 16 17 18 19 20');
});

test('a gap of one page shows that page; few pages show them all', () => {
  assert.equal(show(5, 9), '1 2 3 4 5 6 7 8 9', 'nothing left out');
  assert.equal(show(1, 7), '1 2 3 4 5 6 7', '"…" would hide only 4');
  assert.equal(show(1, 8), '1 2 3 … 6 7 8');
  assert.equal(show(1, 1), '1');
  assert.equal(show(2, 3), '1 2 3');
  assert.deepEqual(pageItems(1, 0), []);
});

test('a page out of range is the nearest real one', () => {
  assert.equal(show(99, 20), show(20, 20));
  assert.equal(show(0, 20), show(1, 20));
});

test('pages of rows in hand', () => {
  assert.equal(pageCount(0, 50), 1);
  assert.equal(pageCount(50, 50), 1);
  assert.equal(pageCount(51, 50), 2);
  const rows = Array.from({ length: 7 }, (_, i) => i);
  assert.deepEqual(slicePage(rows, 1, 3), [0, 1, 2]);
  assert.deepEqual(slicePage(rows, 3, 3), [6]);
  assert.deepEqual(slicePage(rows, 9, 3), [6], 'past the end: the last page');
});

test('which rows a page shows, of how many — ASCII digits in Arabic too', () => {
  assert.equal(rangeText(2, 50, 50, 1243, 'en'), '51–100 of 1,243');
  assert.equal(rangeText(25, 50, 43, 1243, 'ar'), '1,201–1,243 من 1,243');
  assert.equal(rangeText(1, 50, 0, 0, 'en'), '0 of 0');
});
