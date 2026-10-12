/**
 * T140.1 — comparing on the shopper's photo: the store's shelf read and checked like configs, the same kind only (never
 * the same product), the second product at its real size against the first, and one crop for both halves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPARE_MAX, compareChoices, cropRound, shelfFrom, widthBeside } from '@site/lib/shelf';
import { DEMO_WATCH } from '@site/lib/demo-product';

const entry = (ref: string, over: Record<string, unknown> = {}) => ({ ref, name: `Watch ${ref}`, nameAr: null, category: 'watch', caseMm: 40, worn: `https://cdn.t/${ref}/worn.webp`, flat: `https://cdn.t/${ref}/flat.webp`, page: `https://shop.sa/${ref}`, ...over });

test('the shelf read like configs: a bad entry left out, a store page only when https', () => {
  const shelf = shelfFrom({ v: 1, products: [
    entry('a'), entry('b', { page: 'http://shop.sa/b' }), entry('bad-size', { caseMm: 400 }), entry('bad-url', { worn: 'http://x/w.webp' }),
    entry('r', { category: 'ring', caseMm: 18 }), entry('g', { category: 'glasses', caseMm: 140 }), { name: 'no ref' },
  ] });
  assert.deepEqual(shelf.map((c) => c.ref), ['a', 'b', 'r', 'g']);
  assert.equal(shelf[0]!.product.caseMm, 40);
  assert.equal(shelf[0]!.page, 'https://shop.sa/a');
  assert.equal(shelf[1]!.page, null);
  assert.equal(shelf[2]!.product.category, 'ring');
  assert.equal(shelf[3]!.product.category, 'eyewear', 'glasses as the studio names them');
  assert.deepEqual(shelfFrom(null), []);
  assert.deepEqual(shelfFrom({ v: 2, products: [entry('a')] }), [], 'a shelf of another version is not read');
});

test('choices: the same kind, never the same product (by its ref or its picture), at most COMPARE_MAX', () => {
  const shelf = shelfFrom({ v: 1, products: [entry('self'), entry('twin', { worn: 'https://cdn.t/self/worn.webp' }), entry('x'), entry('ring', { category: 'ring', caseMm: 18 })] });
  const current = { ...DEMO_WATCH, worn: 'https://cdn.t/self/worn.webp' };
  assert.deepEqual(compareChoices(shelf, current, 'self').map((c) => c.ref), ['x'], 'not itself (by ref, or by picture under another ref), not a ring');
  const many = shelfFrom({ v: 1, products: Array.from({ length: 30 }, (_, i) => entry(`w${i}`)) });
  assert.equal(compareChoices(many, current, null).length, COMPARE_MAX);
});

test('the second product at its real size beside the first; one crop for both, inside the stage', () => {
  assert.ok(Math.abs(widthBeside(190, 38, 42) - 210) < 1e-9, "42 mm is 42/38 of 38 mm");
  assert.equal(widthBeside(190, 0, 42), 190, 'no size: as wide as the first');
  const stage = { W: 1200, H: 1050 };
  const c = cropRound({ x: 600, y: 500 }, 100, stage);
  assert.equal(c.side, 320);
  assert.deepEqual([c.x, c.y], [440, 340], 'centred on the product');
  const edge = cropRound({ x: 1180, y: 20 }, 100, stage);
  assert.ok(edge.x + edge.side <= 1200 && edge.y >= 0, 'moved inside at an edge');
  assert.equal(cropRound({ x: 600, y: 500 }, 10, stage).side, 260, 'never smaller than 260');
  assert.equal(cropRound({ x: 600, y: 500 }, 900, stage).side, 1050, 'never larger than the stage');
});
