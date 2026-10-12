/**
 * T140.2 — the product lit like the shopper's photo: darker in dim light (never brighter), its colour a little towards
 * the light's; measured from the photo's brightest pixels, so dark clothes or darker skin never read as dim light.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAST_MAX, DARKEST, FULL_LIGHT, NEUTRAL, isNeutral, lightOf, tintOf } from '@site/lib/light';

/** A photo of `n` pixels, each `[r, g, b]` from `paint(i)`. */
const photo = (n: number, paint: (i: number) => [number, number, number]) => {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { const [r, g, b] = paint(i); d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  return d;
};

test('a well-lit photo leaves the product as it is — even when most of it is dark (a dark sleeve, darker skin)', () => {
  const daylight = lightOf(photo(1000, (i) => (i % 2 ? [235, 235, 235] : [120, 110, 100])));
  assert.ok(daylight.level > FULL_LIGHT);
  assert.ok(isNeutral(tintOf(daylight)), JSON.stringify(tintOf(daylight)));
  // 95 % dark clothing, a little bright background: the light is judged by the bright part
  const darkClothes = lightOf(photo(1000, (i) => (i < 950 ? [30, 28, 26] : [230, 230, 230])));
  assert.ok(isNeutral(tintOf(darkClothes)), 'dark things in the photo are not dim light');
});

test('a dim photo: the product darker, in proportion — never darker than DARKEST, never brighter than itself', () => {
  const dim = tintOf(lightOf(photo(1000, (i) => [90 + (i % 20), 90 + (i % 20), 90 + (i % 20)])));
  assert.ok(dim.brightness < 0.85 && dim.brightness >= DARKEST, `dim: ${dim.brightness}`);
  const darker = tintOf(lightOf(photo(1000, () => [40, 40, 40])));
  assert.ok(darker.brightness < dim.brightness, 'darker light, darker product');
  const darkest = tintOf(lightOf(photo(1000, () => [5, 5, 5]))).brightness;
  assert.ok(darkest >= DARKEST && darkest < DARKEST + 0.02, `near black: as dark as it goes, never below DARKEST (${darkest})`);
  assert.equal(tintOf({ level: 0, cast: [1, 1, 1] }).brightness, DARKEST);
  assert.equal(tintOf({ level: 1, cast: [1, 1, 1] }).brightness, 1, 'never brighter');
});

test('a warm lamp: the product a little warmer — at most CAST_MAX either way; blown-out highlights are not the light’s colour', () => {
  const warm = tintOf(lightOf(photo(1000, (i) => (i % 10 === 0 ? [240, 205, 150] : [140, 115, 85]))));
  assert.ok(warm.r > 1 && warm.b < 1, `warmer: ${JSON.stringify(warm)}`);
  assert.ok(warm.r <= 1 + CAST_MAX && warm.b >= 1 - CAST_MAX, 'gently');
  const strong = tintOf({ level: 1, cast: [2, 1, 0.2] });
  assert.equal(strong.r, 1 + CAST_MAX); assert.equal(strong.b, 1 - CAST_MAX);
  // blown-out (255) pixels carry no colour information: a white sky over a cool scene stays cool
  // a blown-out, yellowish sky (30 %) over a scene lit cool: the sky says nothing of the light
  const cool = lightOf(photo(1000, (i) => (i % 10 < 3 ? [255, 252, 180] : i % 10 === 3 ? [190, 210, 235] : [90, 100, 115])));
  assert.ok(cool.cast[2] > cool.cast[0], `the light’s colour from the highlights that are not blown out: ${cool.cast}`);
});

test('nothing to measure: no change', () => {
  assert.deepEqual(tintOf(lightOf(new Uint8ClampedArray(0))), NEUTRAL);
  assert.ok(isNeutral(NEUTRAL));
  assert.equal(isNeutral({ ...NEUTRAL, brightness: 0.9 }), false);
  assert.equal(isNeutral({ ...NEUTRAL, b: 0.95 }), false);
});
