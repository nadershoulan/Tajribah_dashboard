/**
 * T131 — selections as in Photoshop: shapes filled exactly, combined New / Add / Subtract / Intersect, inverted,
 * feathered; a cut clears what is selected or everything else, at any size; the magnetic lasso follows real edges.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_SELECTION, addShape, applyCut, edgeMap, featherMask, invertSelection, isEmptyMask, liveWire, maskOutline, rasterize, selectAll, simplify, snapToEdge,
  type Rgba, type SelShape,
} from '@/lib/selection';
import { NO_EDITS, applyEdits } from '@/lib/image-edit';

const count = (m: Uint8Array) => m.reduce((n, v) => n + (v > 127 ? 1 : 0), 0);
const square = (x0: number, y0: number, x1: number, y1: number): SelShape => ({ kind: 'polygon', points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });

/** A solid picture, `w`×`h`, with a dark square [x0, x1)×[y0, y1) on white. */
function picture(w: number, h: number, box = { x0: 10, y0: 10, x1: 40, y1: 40 }): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1;
    data.set(inside ? [30, 30, 30, 255] : [250, 250, 250, 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
}

test('lasso and polygonal lasso: a closed shape fills exactly, in shares, at any size', () => {
  assert.equal(count(rasterize(addShape(EMPTY_SELECTION, 'new', square(0.25, 0.25, 0.75, 0.75)), 100, 100)), 2500, 'half each way: a quarter');
  assert.equal(count(rasterize(addShape(EMPTY_SELECTION, 'new', square(0.25, 0.25, 0.75, 0.75)), 400, 200)), 200 * 100, 'the same shares on a larger picture');
  const tri: SelShape = { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] };
  const n = count(rasterize(addShape(EMPTY_SELECTION, 'new', tri), 100, 100));
  assert.ok(Math.abs(n - 5000) <= 100, `a triangle is half the picture (${n})`);
  const two: SelShape = { kind: 'polygon', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] };
  assert.ok(isEmptyMask(rasterize(addShape(EMPTY_SELECTION, 'new', two), 50, 50)), 'two points enclose nothing');
  // a pixel is selected when the shape covers its centre — not its corner
  assert.ok(isEmptyMask(rasterize(addShape(EMPTY_SELECTION, 'new', square(0.2, 0.2, 0.8, 0.204)), 100, 100)), 'a sliver short of the row’s centre selects nothing');
  assert.equal(count(rasterize(addShape(EMPTY_SELECTION, 'new', square(0.2, 0.2, 0.8, 0.206)), 100, 100)), 60, 'past the centre: one row');
});

test('the selection brush: a stroke of discs, its radius a share of the larger side', () => {
  const dot = rasterize(addShape(EMPTY_SELECTION, 'new', { kind: 'brush', points: [{ x: 0.5, y: 0.5 }], radius: 0.1 }), 100, 100);
  assert.ok(Math.abs(count(dot) - Math.PI * 100) < 20, `a disc of radius 10 px (${count(dot)})`);
  const wide = rasterize(addShape(EMPTY_SELECTION, 'new', { kind: 'brush', points: [{ x: 0.5, y: 0.5 }], radius: 0.1 }), 200, 100);
  assert.ok(Math.abs(count(wide) - Math.PI * 400) < 40, `on a 200×100 picture the radius is a share of the larger side: 20 px (${count(wide)})`);
  const line = rasterize(addShape(EMPTY_SELECTION, 'new', { kind: 'brush', points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], radius: 0.05 }), 100, 100);
  assert.equal(line[50 * 100 + 50], 255, 'the stroke is continuous between its points');
  assert.equal(line[50 * 100 + 10], 0);
  assert.ok(count(line) > 60 * 10 && count(line) < 60 * 10 + Math.PI * 25 + 40, `a band 60 long, 10 wide, round ends (${count(line)})`);
});

test('New, Add, Subtract, Intersect and Invert combine as in Photoshop', () => {
  const a = square(0, 0, 0.5, 1), b = square(0.25, 0, 0.75, 1);
  const sel = (ops: [Parameters<typeof addShape>[1], SelShape][]) => ops.reduce((s, [m, sh]) => addShape(s, m, sh), EMPTY_SELECTION);
  assert.equal(count(rasterize(sel([['new', a], ['add', b]]), 100, 10)), 750, 'add: the union');
  assert.equal(count(rasterize(sel([['new', a], ['subtract', b]]), 100, 10)), 250, 'subtract: a without b');
  assert.equal(count(rasterize(sel([['new', a], ['intersect', b]]), 100, 10)), 250, 'intersect: both');
  assert.equal(count(rasterize(sel([['new', a], ['add', b], ['new', b]]), 100, 10)), 500, 'new: starts again');
  assert.equal(count(rasterize(invertSelection(sel([['new', a]])), 100, 10)), 500, 'inverted: everything else');
  assert.equal(count(rasterize(selectAll(), 30, 30)), 900, 'select all');
  assert.equal(addShape(invertSelection(sel([['new', a]])), 'new', b).inverted, false, 'a new shape clears the inversion');
});

test('feather softens the edge, keeps the inside; the outline is the selection’s border', () => {
  const hard = rasterize(addShape(EMPTY_SELECTION, 'new', square(0.2, 0.2, 0.8, 0.8)), 100, 100);
  const soft = featherMask(hard, 100, 100, 5);
  assert.equal(soft[50 * 100 + 50], 255, 'deep inside: fully selected');
  assert.equal(soft[2 * 100 + 2], 0, 'far outside: not selected');
  const edge = soft[50 * 100 + 20]!;
  assert.ok(edge > 60 && edge < 200, `on the border: half (${edge})`);
  assert.equal(featherMask(hard, 100, 100, 0), hard, 'no feather: the same mask');
  const outline = maskOutline(hard, 100, 100);
  assert.equal(outline.length, 4 * 60 - 4, 'the square’s border pixels');
});

test('a cut clears what is selected, or keeps only it; in the editor it runs after the background, before the turn', () => {
  const img = picture(50, 50);
  const sel = addShape(EMPTY_SELECTION, 'new', square(0, 0, 0.5, 1));
  const erased = applyCut(img, { action: 'erase', selection: sel, feather: 0 });
  assert.deepEqual([erased.data[(10 * 50 + 5) * 4 + 3], erased.data[(10 * 50 + 45) * 4 + 3]], [0, 255], 'erase: the left half cleared');
  const kept = applyCut(img, { action: 'keep', selection: sel, feather: 0 });
  assert.deepEqual([kept.data[(10 * 50 + 5) * 4 + 3], kept.data[(10 * 50 + 45) * 4 + 3]], [255, 0], 'keep only: the right half cleared');
  const turned = applyEdits(img, { ...NO_EDITS, cuts: [{ action: 'erase', selection: sel, feather: 0 }], rotate: 90 });
  assert.ok(turned.ok);
  assert.equal(turned.image.data[(5 * 50 + 25) * 4 + 3], 0, 'the cleared left half is the top after a quarter turn clockwise');
  assert.equal(turned.image.data[(45 * 50 + 25) * 4 + 3], 255);
  const twice = applyEdits(img, { ...NO_EDITS, cuts: [{ action: 'keep', selection: sel, feather: 0 }, { action: 'erase', selection: addShape(EMPTY_SELECTION, 'new', square(0, 0, 1, 0.5)), feather: 0 }] });
  assert.ok(twice.ok);
  assert.equal(twice.image.data[(40 * 50 + 5) * 4 + 3], 255, 'cuts run in order: only the bottom-left quarter is left');
  assert.equal(twice.image.data[(10 * 50 + 5) * 4 + 3], 0);
});

test('the magnetic lasso: edges found, the pointer snapped to the nearest edge, the path following the edge round a corner', () => {
  const img = picture(60, 60);
  const edges = edgeMap(img);
  assert.ok(edges[25 * 60 + 10]! > 0.5, 'the square’s left side is an edge');
  assert.ok(edges[25 * 60 + 25]! < 0.05, 'its flat inside is not');
  const snapped = snapToEdge(edges, 60, 60, { x: 14, y: 25 }, 8);
  assert.ok(Math.abs(snapped.x - 10) <= 1 && snapped.y === 25, `snapped to the edge (${snapped.x}, ${snapped.y})`);
  assert.deepEqual(snapToEdge(edges, 60, 60, { x: 25, y: 25 }, 3), { x: 25, y: 25 }, 'nothing within reach: stays put');

  // from the left side to the top side: the straight line cuts through the inside; the wire goes round the corner
  const path = liveWire(edges, 60, 60, { x: 10, y: 30 }, { x: 30, y: 10 }, 6);
  assert.deepEqual([path[0], path[path.length - 1]], [{ x: 10, y: 30 }, { x: 30, y: 10 }]);
  const onEdge = path.filter((p) => edges[p.y * 60 + p.x]! > 0.3).length / path.length;
  assert.ok(onEdge > 0.9, `${Math.round(onEdge * 100)}% of the path is on the edge`);
  assert.ok(path.some((p) => Math.abs(p.x - 10) <= 1 && Math.abs(p.y - 10) <= 1), 'it passes the corner');
  const weak = liveWire(edges, 60, 60, { x: 10, y: 30 }, { x: 30, y: 10 }, 6, 1.1);
  assert.ok(weak.length < path.length, 'with every edge below Contrast, it goes straight');
  const line = simplify(path, 0.75);
  assert.ok(line.length < path.length && line.length >= 3, `simplified to ${line.length} points, the corner kept`);
});
