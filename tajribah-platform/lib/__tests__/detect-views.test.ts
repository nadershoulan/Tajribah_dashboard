/**
 * T138 — the harder looks at a still photo, shared by the hand and the face: their order, how each look's points come
 * back to the photo, and when a hand or face found small is looked at once more, closer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLEAN_SIDES, CLOSER, CROPS, DARK, GRAINY, SHRINK, SMALL, closerCrop, closerLook, fromCrop, fromShrunk, grainOf, levelsOf, needsCleaning, views, type Makers, type Rect } from '@site/lib/detect-views';
import { rotatePoint } from '@site/lib/placement';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
const fake: Makers = {
  light: () => ({ brightness: 0.5, grain: 2 }),
  cleaned: () => ({ look: 'cleaned' }) as unknown as HTMLCanvasElement,
  turned: (_, q) => ({ look: `turned ${q}` }) as unknown as HTMLCanvasElement,
  shrunk: () => ({ look: 'shrunk' }) as unknown as HTMLCanvasElement,
  cropped: (_, c: Rect) => ({ look: `crop ${c.x},${c.y}` }) as unknown as HTMLCanvasElement,
};

test('the looks, in order: as it is, the turns asked for, shrunk, then the crops — the middle first', () => {
  const img = { width: 100, height: 80 } as HTMLImageElement;
  const all = [...views(img, [1, 3, 2], fake)];
  assert.deepEqual(all.map((v) => v.how), ['as-is', 'turned', 'turned', 'turned', 'shrunk', 'zoomed', 'zoomed', 'zoomed', 'zoomed', 'zoomed']);
  assert.equal(all[0]!.picture, img);
  assert.deepEqual(all.slice(1, 4).map((v) => v.quarters), [1, 3, 2]);
  assert.deepEqual(CROPS[0], { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, 'the middle crop first: what a shopper photographs is mostly in the middle');
  assert.ok(CROPS.every((c) => c.w === 0.6 && c.h === 0.6 && c.x >= 0 && c.y >= 0 && c.x + c.w <= 1 && c.y + c.h <= 1), 'each inside the photo');
  // made only when reached: when the first look finds something, nothing else is made
  let made = 0;
  const counting: Makers = { light: () => ({ brightness: 0.5, grain: 2 }), cleaned: () => { made++; return img; }, turned: () => { made++; return img; }, shrunk: () => { made++; return img; }, cropped: () => { made++; return img; } };
  assert.equal(views(img, [1, 3], counting).next().value?.how, 'as-is');
  assert.equal(made, 0);
});

test('each look’s points come back to the photo as it is shown', () => {
  const p = { x: 0.3, y: 0.7 };
  const all = [...views({ width: 100, height: 80 } as HTMLImageElement, [1, 3, 2], fake)];
  for (const v of all.filter((x) => x.how === 'turned')) assert.ok(close(v.back(rotatePoint(p, v.quarters)), p), `turned ${v.quarters}`);
  // shrunk: the photo sits in the middle at SHRINK of its size
  const onShrunk = { x: (1 - SHRINK) / 2 + p.x * SHRINK, y: (1 - SHRINK) / 2 + p.y * SHRINK };
  assert.ok(close(fromShrunk(onShrunk), p));
  assert.ok(close(all.find((v) => v.how === 'shrunk')!.back(onShrunk), p));
  // each crop
  CROPS.forEach((c, i) => {
    const onCrop = { x: (p.x - c.x) / c.w, y: (p.y - c.y) / c.h };
    assert.ok(close(fromCrop(onCrop, c), p));
    assert.ok(close(all[5 + i]!.back(onCrop), p), `crop ${i}`);
  });
});

test('a hand or face found small gets a closer, square crop round it, inside the photo; a big one does not', () => {
  const w = 1000, h = 800;
  assert.equal(closerCrop([{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.7 }], w, h), null, 'big: spans half the shorter side');
  assert.equal(closerCrop([{ x: 0.2, y: 0.2 }, { x: 0.2 + (SMALL * 800 + 1) / 1000, y: 0.25 }], w, h), null, 'just over the line: not small');
  const pts = [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }]; // 100 px of an 800 px side
  const c = closerCrop(pts, w, h)!;
  assert.ok(c, 'small: a closer look');
  assert.ok(Math.abs(c.w * w - c.h * h) < 1e-6, 'square');
  assert.ok(Math.abs(c.w * w - 100 * CLOSER) < 1e-6, `${CLOSER} times its size`);
  assert.ok(pts.every((p) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h), 'round it');
  const corner = closerCrop([{ x: 0.98, y: 0.97 }, { x: 0.995, y: 0.99 }], w, h)!;
  assert.ok(corner.x >= 0 && corner.y >= 0 && corner.x + corner.w <= 1 + 1e-9 && corner.y + corner.h <= 1 + 1e-9, 'at the corner: moved in, never outside');
  assert.equal(closerCrop([], w, h), null);
});

test('the closer look replaces the first answer only when it finds something there', () => {
  const img = { width: 1000, height: 800 } as HTMLImageElement;
  const small = [[{ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.56 }]];
  const crops: Rect[] = [];
  const make: Makers = { ...fake, cropped: (_, c) => { crops.push(c); return img; } };
  assert.deepEqual(closerLook(() => [], img, small, make), { found: small, closer: false }, 'not found closer: the first answer stays');
  const near = closerLook(() => [[{ x: 0.5, y: 0.5, z: 0.2 }]], img, small, make);
  assert.equal(near.closer, true);
  assert.ok(close(near.found[0]![0]!, fromCrop({ x: 0.5, y: 0.5 }, crops[1]!)), 'back on the photo');
  assert.equal((near.found[0]![0] as { z?: number }).z, 0.2, 'depth kept');
  const big = [[{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }]];
  assert.deepEqual(closerLook(() => { throw new Error('not asked'); }, img, big, make), { found: big, closer: false }, 'big: no closer look at all');
});

test('a dark or grainy photo is looked at cleaned first — larger, then smaller — then as usual; a clean one never', () => {
  const img = { width: 1000, height: 800 } as HTMLImageElement;
  const lit = (brightness: number, grain: number): Makers => ({ ...fake, light: () => ({ brightness, grain }), cleaned: (_, side) => ({ look: `cleaned ${side}` }) as unknown as HTMLCanvasElement });
  const grainy = [...views(img, [1], lit(0.5, 20))];
  assert.deepEqual(grainy.slice(0, 3).map((v) => v.how), ['cleaned', 'cleaned', 'as-is']);
  assert.deepEqual(grainy.slice(0, 2).map((v) => (v.picture as unknown as { look: string }).look), CLEAN_SIDES.map((side) => `cleaned ${side}`));
  assert.ok(CLEAN_SIDES[0]! > CLEAN_SIDES[1]!, 'the larger first (a dark photo), the smaller for heavy grain');
  assert.ok(close(grainy[0]!.back({ x: 0.3, y: 0.7 }), { x: 0.3, y: 0.7 }), 'the same picture, only smaller: its points as they are');
  assert.equal([...views(img, [1], lit(0.15, 2))][0]!.how, 'cleaned', 'dark');
  assert.ok(![...views(img, [1], lit(0.5, 2))].some((v) => v.how === 'cleaned'), 'a clean photo: never');
  assert.equal(needsCleaning({ brightness: DARK, grain: GRAINY - 0.5 }), false);
  assert.equal(needsCleaning({ brightness: DARK - 0.01, grain: 0 }), true);
  assert.equal(needsCleaning({ brightness: 0.6, grain: GRAINY }), true);
});

test('the light stretched from the darkest 1 % to the brightest 1 %, lifted when still dark; grain is the typical neighbour difference', () => {
  const dim = Array.from({ length: 1000 }, (_, i) => 20 + (i % 61)); // 20…80, evenly
  const a = levelsOf(dim);
  assert.ok(Math.abs(a.lo - 20 / 255) < 0.01 && Math.abs(a.hi - 80 / 255) < 0.01, `stretched to its own range: ${a.lo}, ${a.hi}`);
  assert.equal(a.gamma, 1, 'evenly spread: no lift');
  const dark = [...Array.from({ length: 950 }, () => 12), ...Array.from({ length: 50 }, () => 220)];
  assert.ok(levelsOf(dark).gamma < 1, 'mostly dark even after stretching: lifted');
  assert.equal(levelsOf([]).gamma, 1);
  const flat = levelsOf(Array.from({ length: 10 }, () => 128));
  assert.ok(flat.hi - flat.lo > 0.099, 'a flat photo: never divided by nothing');
  assert.equal(grainOf([10, 11, 12, 13, 14, 15], 6), 1, 'a smooth ramp');
  assert.equal(grainOf([0, 40, 0, 40, 0, 40], 6), 40, 'grain');
  assert.equal(grainOf([0, 0, 100, 100], 2), 0, 'the step between rows is not grain');
  assert.equal(grainOf([0, 100, 0, 100], 1), 0, 'one pixel a row: no neighbours, no grain (rows are not neighbours)');
  assert.equal(grainOf([10, 11, 12, 13, 14, 250], 6), 1, 'one strong edge in the picture is not grain');
});

