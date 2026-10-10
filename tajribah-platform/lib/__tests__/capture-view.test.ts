/**
 * T134.3 — the phone page's picture maths: filling the screen, where a pose lands, a drag and a pinch, the mirrored
 * front camera.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragged, fillFor, fitOf, liftedAbove, mirrored, onPicture, onScreen, pinched } from '@site/lib/capture-view';

const phone = { width: 390, height: 844 };
const frame = { width: 1080, height: 1440 }; // a 3:4 portrait photo

test('edge to edge cuts two sides; whole shows bars; a point comes back where it was', () => {
  const cover = fitOf(phone, frame, 'cover');
  assert.ok(Math.abs(cover.scale - 844 / 1440) < 1e-9, 'tall screen: the height fills it');
  assert.ok(cover.ox < 0 && cover.oy === 0, 'cut at the sides');
  const contain = fitOf(phone, frame, 'contain');
  assert.ok(Math.abs(contain.scale - 390 / 1080) < 1e-9);
  assert.ok(contain.ox === 0 && contain.oy > 0, 'bars above and below');
  const p = { x: 300, y: 900 };
  const back = onPicture({ x: cover.ox + p.x * cover.scale, y: cover.oy + p.y * cover.scale }, cover);
  assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
  const s = onScreen({ x: 540, y: 720, width: 200, angle: 12 }, cover);
  assert.ok(Math.abs(s.x - 195) < 1e-9 && Math.abs(s.y - 422) < 1e-9, 'the middle of the photo is the middle of the screen');
  assert.ok(Math.abs(s.width - 200 * cover.scale) < 1e-9 && s.angle === 12);
});

test('edge to edge, unless the product would be cut off', () => {
  assert.equal(fillFor(phone, frame, { x: 540, y: 720 }), 'cover');
  assert.equal(fillFor(phone, frame, { x: 60, y: 720 }), 'contain', 'near the photo’s side: shown whole');
  assert.equal(fillFor(phone, frame, null), 'cover');
});

test('a finger moves the product; two size, turn and move it', () => {
  const fit = { scale: 0.5, ox: 0, oy: 0 };
  const start = { x: 100, y: 100, width: 80, angle: 0 };
  assert.deepEqual(dragged(start, 10, -20, fit), { x: 120, y: 60, width: 80, angle: 0 }, 'screen pixels are two picture pixels');
  const p = pinched(start, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 200 }, fit, 1000);
  assert.equal(p.width, 160, 'twice as far apart: twice as wide');
  assert.ok(Math.abs(p.angle - 90) < 1e-9, 'the line turned a quarter');
  assert.ok(Math.abs(p.x - (100 + (0 - 50) / 0.5)) < 1e-9 && Math.abs(p.y - (100 + 100 / 0.5)) < 1e-9, 'it moved with the fingers’ middle');
  assert.equal(pinched(start, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 10000, y: 0 }, fit, 300).width, 300, 'never wider than the limit');
});

test('the front camera is shown as a mirror: its points too', () => {
  assert.deepEqual(mirrored([{ x: 0.2, y: 0.4, z: 1 }]), [{ x: 0.8, y: 0.4, z: 1 }]);
});

test('the photo slides up just enough that the buttons never cover the product — never down', () => {
  const fit = { scale: 0.5, ox: 0, oy: 0 };
  const low = { x: 400, y: 1400, width: 100, angle: 0 }; // its bottom at (1400 + 50) × 0.5 = 725 on the screen
  assert.equal(liftedAbove(fit, low, 1, 600).oy, -125);
  assert.equal(liftedAbove(fit, { ...low, y: 200 }, 1, 600).oy, 0, 'already clear: unchanged');
  assert.equal(liftedAbove(fit, null, 1, 600), fit);
});
