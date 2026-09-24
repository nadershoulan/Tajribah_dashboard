import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, editErrors, parseMm } from '@/lib/product-edit';
import { demoSource } from '@/lib/data';
import { DEMO_PRODUCTS } from '@/lib/demo-data';
import { ApiError } from '@/lib/api-client';

test('millimetres: Arabic digits and separators fold; blank clears; out of range is refused', () => {
  assert.deepEqual(parseMm('41'), { value: 41 });
  assert.deepEqual(parseMm('٤١٫٥'), { value: 41.5 }, 'Arabic-Indic digits and the Arabic decimal separator');
  assert.deepEqual(parseMm('۴۲'), { value: 42 }, 'Extended Arabic-Indic (Persian keyboards)');
  assert.deepEqual(parseMm('41,5'), { value: 41.5 });
  assert.deepEqual(parseMm('  '), { value: null });
  assert.ok('error' in parseMm('0'));
  assert.deepEqual(parseMm('3000'), { value: 3000 }, 'exactly 3 m is allowed');
  assert.ok('error' in parseMm('3001'), 'over 3 m is a unit mistake');
  assert.ok('error' in parseMm('4 cm'));
  assert.ok('error' in parseMm('-3'));
});

test('AR needs width and height; switching it on without them, or clearing them while on, is refused', () => {
  const bare = { ...DEMO_PRODUCTS[0], arEnabled: false, dimensions: null };
  assert.ok('arEnabled' in editErrors(bare, { arEnabled: true }));
  assert.ok('arEnabled' in editErrors(bare, { arEnabled: true, dimensions: { widthMm: 40 } }));
  assert.deepEqual(editErrors(bare, { arEnabled: true, dimensions: { widthMm: 40, heightMm: 48 } }), {});
  const on = { ...bare, arEnabled: true, dimensions: { widthMm: 40, heightMm: 48 } };
  assert.ok('arEnabled' in editErrors(on, { dimensions: null }));
  assert.deepEqual(Object.keys(editErrors(bare, { dimensions: { widthMm: 5000 } })), ['dimensions.widthMm']);
});

test('the demo source saves an accepted edit for the page load and refuses the rest like the API', async () => {
  const id = DEMO_PRODUCTS[0].id;
  await assert.rejects(() => demoSource.updateProduct(id, { arEnabled: true, dimensions: null }),
    (e: unknown) => e instanceof ApiError && e.status === 422 && !!e.fields?.arEnabled);
  const saved = await demoSource.updateProduct(id, { dimensions: { widthMm: 40.5, heightMm: 48 }, arEnabled: true });
  assert.equal(saved.arEnabled, true);
  assert.deepEqual((await demoSource.product(id))?.dimensions, { widthMm: 40.5, heightMm: 48 });
  assert.deepEqual((await demoSource.products({ q: DEMO_PRODUCTS[0].name })).rows[0].dimensions, { widthMm: 40.5, heightMm: 48 }, 'the list sees it too');
  await assert.rejects(() => demoSource.updateProduct('nope', {}), (e: unknown) => e instanceof ApiError && e.status === 404);
  assert.equal(applyEdit(saved, {}).dimensions, saved.dimensions);
});
