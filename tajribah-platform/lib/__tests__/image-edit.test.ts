/**
 * T128 — the picture editor's steps, on pictures small enough to check pixel by pixel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDIT_STEPS, MAX_SIDE, MAX_SPOTS, NO_EDITS, adjust, applyEdits, crop, eraseAt, flip, isEdited, pad, resize, rotate, trim, type Edits, type Rgba,
} from '@/lib/image-edit';

/** A w×h picture whose pixel (x, y) is opaque with red = x, green = y (so every pixel says where it came from). */
function grid(w: number, h: number): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x, y, 0, 255], (y * w + x) * 4);
  return { data, width: w, height: h };
}
const px = (img: Rgba, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

/** A product (solid red) in the middle of a plain white picture — a store photo, small. */
function onWhite(w = 40, h = 30, box = { x: 10, y: 8, w: 20, h: 14 }): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
    data.set(inside ? [200, 20, 20, 255] : [255, 255, 255, 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
}
const edits = (e: Partial<Edits>): Edits => ({ ...NO_EDITS, ...e });

test('flip mirrors exactly, left–right and top–bottom', () => {
  const g = grid(3, 2);
  assert.deepEqual(px(flip(g, true, false), 0, 0), [2, 0, 0, 255]);
  assert.deepEqual(px(flip(g, false, true), 0, 0), [0, 1, 0, 255]);
  assert.deepEqual(px(flip(g, true, true), 2, 1), [0, 0, 0, 255]);
  assert.equal(flip(g, false, false), g, 'nothing to do: the same picture');
});

test('quarter turns are exact; a full turn and its negatives land where they should', () => {
  const g = grid(3, 2); // 3 wide, 2 tall
  const r90 = rotate(g, 90);
  assert.deepEqual([r90.width, r90.height], [2, 3]);
  assert.deepEqual(px(r90, 1, 0), [0, 0, 0, 255], 'the top-left corner goes to the top-right');
  assert.deepEqual(px(r90, 0, 2), [2, 1, 0, 255], 'the bottom-right goes to the bottom-left');
  assert.deepEqual(px(rotate(g, 180), 0, 0), [2, 1, 0, 255]);
  assert.deepEqual(rotate(g, -90).data, rotate(g, 270).data, '−90° is 270°');
  assert.deepEqual(rotate(g, 360), g, 'a full turn changes nothing');
  assert.deepEqual(rotate(g, 450).data, r90.data, '450° is 90°');
});

test('any angle: the picture grows to hold the corners, the corners are clear, the centre keeps its colour', () => {
  const sq: Rgba = { data: new Uint8ClampedArray(20 * 20 * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : i % 4 === 0 ? 180 : 40)), width: 20, height: 20 };
  const r = rotate(sq, 45);
  assert.ok(r.width >= 28 && r.width <= 29, `width ${r.width}`);
  assert.equal(px(r, 0, 0)[3], 0, 'a corner is clear');
  const mid = px(r, Math.floor(r.width / 2), Math.floor(r.height / 2));
  assert.deepEqual([mid[0], mid[3]], [180, 255], 'the middle is the picture, unchanged');
  // no dark fringe: the clear outside never tints the edge (alpha-weighted sampling)
  for (let i = 0; i < r.data.length; i += 4) if (r.data[i + 3]! > 0) assert.ok(r.data[i]! >= 179, 'edge colour is the picture’s own');
});

test('resampling never darkens an edge: clear pixels (black underneath, as cut-outs often are) do not bleed in', () => {
  const edge: Rgba = { data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0, 200, 30, 30, 255, 200, 30, 30, 255]), width: 4, height: 1 };
  const big = resize(edge, 2);
  for (let x = 0; x < big.width; x++) {
    const [r, , , a] = px(big, x, 0);
    if (a! > 0) assert.equal(r, 200, `pixel ${x}: the red stays red as it fades (alpha ${a})`);
  }
  assert.ok(px(big, 3, 0)[3]! > 0 && px(big, 3, 0)[3]! < 255, 'the edge fades in alpha, not in colour');
});

test('resize halves, doubles, and shrinks far in steps without losing the size it was asked for', () => {
  const g = grid(8, 4);
  assert.deepEqual([resize(g, 0.5).width, resize(g, 0.5).height], [4, 2]);
  assert.deepEqual([resize(g, 2).width, resize(g, 2).height], [16, 8]);
  const tiny = resize(grid(100, 100), 0.1);
  assert.deepEqual([tiny.width, tiny.height], [10, 10]);
  assert.equal(resize(g, 1), g);
});

test('light and colour: brighter, flatter, grey — and clear pixels stay clear', () => {
  const one: Rgba = { data: new Uint8ClampedArray([100, 150, 50, 255, 10, 20, 30, 0]), width: 2, height: 1 };
  assert.ok(px(adjust(one, 50, 0), 0, 0)[0]! > 100, 'brighter');
  assert.deepEqual(px(adjust(one, 0, -100), 0, 0).slice(0, 3), [128, 128, 128], 'no contrast: mid grey');
  const grey = px(adjust(one, 0, 0, -100), 0, 0);
  assert.equal(grey[0], grey[1]); assert.equal(grey[1], grey[2]);
  assert.equal(px(adjust(one, 80, 80, 80), 1, 0)[3], 0, 'a clear pixel stays clear');
  assert.equal(adjust(one, 0, 0, 0), one);
});

test('crop by percent from each side; trim to what is not clear; pad with a clear margin', () => {
  const c = crop(grid(4, 4), 25, 25, 25, 25)!;
  assert.deepEqual([c.width, c.height, px(c, 0, 0)[0], px(c, 0, 0)[1]], [2, 2, 1, 1]);
  assert.equal(crop(grid(4, 4), 45, 0, 45, 0), null, '45% off top and bottom of 4px rounds to nothing');
  assert.equal(crop(grid(20, 20), 45, 0, 45, 0)!.height, 2);
  const framed = pad(grid(10, 10), 20);
  assert.deepEqual([framed.width, framed.height], [14, 14]);
  assert.equal(px(framed, 0, 0)[3], 0);
  assert.deepEqual(px(framed, 2, 2), [0, 0, 0, 255], 'the picture sits inside the margin');
  const back = trim(framed)!;
  assert.deepEqual([back.width, back.height], [10, 10], 'trim takes the margin off again');
  assert.equal(trim({ data: new Uint8ClampedArray(16), width: 2, height: 2 }), null, 'all clear: nothing left');
});

test('the steps run in order on a store photo: background off, turned, scaled — and failures say why', () => {
  const photo = onWhite();
  const cut = applyEdits(photo, edits({ removeBackground: true }));
  assert.ok(cut.ok);
  assert.deepEqual([cut.image.width, cut.image.height], [20, 14], 'white gone, cropped to the product');
  const turned = applyEdits(photo, edits({ removeBackground: true, rotate: 90, scale: 50 }));
  assert.ok(turned.ok);
  assert.deepEqual([turned.image.width, turned.image.height], [7, 10], 'turned a quarter, then halved');
  // a scene behind the product is not a plain background
  const noisy = grid(30, 30);
  for (let i = 0; i < noisy.data.length; i += 4) { const p = i / 4; noisy.data[i] = (p * 53) % 256; noisy.data[i + 1] = (p * 97) % 256; noisy.data[i + 2] = (p * 31) % 256; }
  assert.deepEqual(applyEdits(noisy, edits({ removeBackground: true })), { ok: false, reason: 'not_plain' });
  assert.deepEqual(applyEdits(grid(4, 4), edits({ cropLeft: 45, cropRight: 45, cropTop: 45, cropBottom: 45 })), { ok: false, reason: 'nothing_left' });
  assert.equal(applyEdits(grid(20, 20), edits({ cropLeft: 45, cropRight: 45 })).ok, true);
  assert.deepEqual(applyEdits(grid(2000, 10), edits({ scale: 400 })), { ok: false, reason: 'too_large' });
  assert.deepEqual(applyEdits(photo, NO_EDITS), { ok: true, image: photo }, 'no edits: the picture as it was');
});

test('the background step widens with tolerance: an off-white background comes off when allowed to', () => {
  const photo = onWhite();
  // tint the background a little unevenly (as a phone photo of a white sheet)
  for (let i = 0; i < photo.data.length; i += 4) if (photo.data[i + 1]! > 200) { const off = (i / 4) % 7 * 6; photo.data[i] = 255 - off; photo.data[i + 1] = 255 - off; photo.data[i + 2] = 250 - off; }
  assert.equal(applyEdits(photo, edits({ removeBackground: true, tolerance: 5 })).ok, false, 'strict: refused');
  const loose = applyEdits(photo, edits({ removeBackground: true, tolerance: 60 }));
  assert.ok(loose.ok && loose.image.width === 20, 'widened: the product alone');
});

test('a new tool is one more step; isEdited knows a picture was changed', () => {
  assert.deepEqual(EDIT_STEPS.map((s) => s.id), ['erase', 'background', 'crop', 'rotate', 'flip', 'adjust', 'trim', 'padding', 'scale']);
  const invert = { id: 'invert', applies: () => true, run: (img: Rgba) => ({ ...img, data: img.data.map((v, i) => (i % 4 === 3 ? v : 255 - v)) }) };
  const out = applyEdits(grid(2, 1), NO_EDITS, [...EDIT_STEPS, invert]);
  assert.ok(out.ok);
  assert.deepEqual(px(out.image, 0, 0), [255, 255, 255, 255]);
  assert.equal(isEdited(NO_EDITS), false);
  assert.equal(isEdited(edits({ flipX: true })), true);
  assert.equal(isEdited(edits({ erase: [] })), false, 'an emptied erase list is no edit');
  assert.equal(isEdited(edits({ erase: [{ x: 0.5, y: 0.5 }] })), true);
  assert.ok(MAX_SIDE >= 2000);
});

/** Two grey squares (a bust, a stand) on white, with a red product between them: 30×10. */
function twoGreys(): Rgba {
  const w = 30, h = 10, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = x < 10 ? [128, 128, 128] : x < 20 ? [200, 20, 20] : [128, 128, 128];
    data.set([...c, 255], (y * w + x) * 4);
  }
  return { data, width: w, height: h };
}

test('click to erase: the connected area of the clicked colour goes, the same colour elsewhere stays, the edge is soft', () => {
  const img = twoGreys();
  const out = eraseAt(img, [{ x: 0.1, y: 0.5 }], 30);
  assert.equal(px(out, 0, 0)[3], 0, 'the clicked grey is cleared');
  assert.equal(px(out, 9, 9)[3], 0, 'all of it, to its edge');
  assert.equal(px(out, 15, 5)[3], 255, 'the product (another colour) stays');
  assert.equal(px(out, 25, 5)[3], 255, 'the other grey is not connected to the click: it stays');
  assert.deepEqual(px(out, 0, 0).slice(0, 3), [128, 128, 128], 'colour kept under the clear (the background step still reads the edges)');
  const both = eraseAt(img, [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], 30);
  assert.equal(px(both, 25, 5)[3], 0, 'a second click takes the second grey');
  // a soft edge: a pixel a little off the clicked colour, beside the cleared area, is partly see-through
  const soft = twoGreys(); soft.data.set([170, 128, 128, 255], (5 * 30 + 10) * 4); // distance 42 from the grey: between 30 and 60
  const a = px(eraseAt(soft, [{ x: 0.1, y: 0.5 }], 30), 10, 5)[3]!;
  assert.ok(a > 0 && a < 255, `edge alpha ${a}`);
  assert.equal(eraseAt(img, [], 30), img, 'no clicks: the same picture');
  assert.equal(eraseAt(out, [{ x: 0.1, y: 0.5 }], 30), out, 'a click on what is already clear changes nothing');
  assert.ok(MAX_SPOTS >= 20);
});

test('erase clicks are shares of the source: the same spot at any size, and they run before a turn', () => {
  const big = resize(twoGreys(), 4);
  assert.equal(px(eraseAt(big, [{ x: 0.1, y: 0.5 }], 30), 2, 2)[3], 0, 'at four times the size the same click takes the same grey');
  const right = eraseAt(big, [{ x: 0.9, y: 0.5 }], 30);
  assert.deepEqual([px(right, 110, 20)[3], px(right, 2, 20)[3]], [0, 255], 'a click at 90% across takes the right grey, not a spot counted in pixels');
  const turned = applyEdits(twoGreys(), edits({ erase: [{ x: 0.1, y: 0.5 }], rotate: 90 }));
  assert.ok(turned.ok);
  assert.deepEqual([turned.image.width, turned.image.height], [10, 30]);
  assert.equal(px(turned.image, 5, 2)[3], 0, 'the erased left grey is at the top after a quarter turn clockwise');
  assert.equal(px(turned.image, 5, 27)[3], 255, 'the right grey, at the bottom, stays');
});
