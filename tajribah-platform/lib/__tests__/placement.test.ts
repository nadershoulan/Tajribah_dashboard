/**
 * T134.5 — placing a product on the shopper's own photo from the hand's landmarks: true size with the hand as the
 * ruler, on the wrist across the forearm at any angle, a ring on its finger, a confidence that drops for a hand too
 * small; points from a turned photo brought back exactly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KNUCKLE_SPAN_MM, MIN_SPAN_PX, PALM_LENGTH_MM, WATCH_BACK, handPoints, handScale, ringPlacement, rotatePoint, unrotate, watchPlacement,
  type HandPoints, type Pt,
} from '@site/lib/placement';

/**
 * A right hand, back to the camera, drawn at `pxPerMm` from adult measures: wrist at `at`, fingers pointing along
 * `deg` (0 = to the right, 90 = down).
 */
function hand(at: Pt, deg: number, pxPerMm: number, squash = 1): HandPoints {
  const r = (deg * Math.PI) / 180, ux = Math.cos(r), uy = Math.sin(r), vx = -uy, vy = ux; // u: along the fingers, v: across
  const p = (along: number, across: number): Pt => ({ x: at.x + (ux * along + vx * across * squash) * pxPerMm, y: at.y + (uy * along + vy * across * squash) * pxPerMm });
  const half = KNUCKLE_SPAN_MM / 2;
  return {
    wrist: p(0, 0), middleMcp: p(PALM_LENGTH_MM, 0), middlePip: p(PALM_LENGTH_MM + 30, 0),
    indexMcp: p(PALM_LENGTH_MM - 4, -half), pinkyMcp: p(PALM_LENGTH_MM - 10, half),
    ringMcp: p(PALM_LENGTH_MM - 6, half * 0.6), ringPip: p(PALM_LENGTH_MM + 22, half * 0.65),
  };
}
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(2)} vs ${b.toFixed(2)}`);

test('the hand is the ruler: 58 mm across the knuckles, 100 mm wrist to knuckle — the larger wins', () => {
  near(handScale(hand({ x: 400, y: 500 }, 0, 2)), 2, 0.05, 'a hand seen flat');
  near(handScale(hand({ x: 400, y: 500 }, 0, 2, 0.5)), 2, 0.05, 'seen at an angle (knuckles squeezed): the palm still measures it');
  near(handScale(hand({ x: 400, y: 500 }, 0, 3)), 3, 0.05, 'closer: bigger');
});

test('a watch at its real case width, just above the wrist bone up the arm, its strap across the forearm', () => {
  const h = hand({ x: 600, y: 500 }, 0, 2); // fingers to the right; the forearm runs to the left
  const w = watchPlacement(h, 38);
  near(w.width, 38 * 2, 1.5, 'a 38 mm case at 2 px a millimetre');
  near(w.x, 600 - PALM_LENGTH_MM * WATCH_BACK * 2, 1, 'up the forearm from where the hand begins');
  near(w.y, 500, 1, 'on the arm, not beside it');
  near(w.angle, 0, 0.5, 'the picture upright: across a horizontal arm');
  const small = watchPlacement(h, 26), big = watchPlacement(h, 46);
  assert.ok(small.width < w.width && w.width < big.width, 'a bigger case is drawn bigger — no more “90 % of the palm” for every watch');
});

test('at any angle: the watch follows the forearm, and stays on the arm side of the wrist', () => {
  for (const deg of [-90, -37, 45, 120, 180]) {
    const h = hand({ x: 500, y: 500 }, deg, 2.5);
    const w = watchPlacement(h, 40);
    near(((w.angle - deg + 540) % 360) - 180, 0, 0.5, `turned with the arm at ${deg}°`);
    const toKnuckle = Math.hypot(h.middleMcp.x - w.x, h.middleMcp.y - w.y), toWrist = Math.hypot(h.wrist.x - w.x, h.wrist.y - w.y);
    assert.ok(toKnuckle > toWrist + 50, `${deg}°: on the arm side of the wrist, not on the hand`);
  }
});

test('confidence: the detector’s score, lowered for a hand too small to measure', () => {
  assert.ok(watchPlacement(hand({ x: 500, y: 500 }, 0, 2), 40, 0.9).confidence > 0.8, 'a clear, near hand');
  const far = hand({ x: 500, y: 500 }, 0, (MIN_SPAN_PX * 0.7) / KNUCKLE_SPAN_MM);
  assert.ok(watchPlacement(far, 40, 0.9).confidence < 0.45, 'a far-off hand: the studio asks to check the fit');
  assert.ok(watchPlacement(hand({ x: 500, y: 500 }, 0, 2), 40, 0.3).confidence <= 0.3, 'a weak sighting stays weak');
});

test('a ring on the ring finger, between its first two joints, across the finger, at its real width', () => {
  const h = hand({ x: 400, y: 600 }, -90, 2); // fingers up
  const r = ringPlacement(h, 20);
  near(r.width, 40, 1.5, 'a 20 mm ring at 2 px a millimetre');
  assert.ok(r.y < h.ringMcp.y && r.y > h.ringPip.y, 'between the base and middle joints');
  near(Math.abs(r.angle) % 180, 0, 6, 'across an upright finger: the band horizontal');
});

test('from MediaPipe’s landmarks on a photo drawn smaller and offset on the stage', () => {
  const lm = Array.from({ length: 21 }, (_, i) => ({ x: i / 40, y: 0.5 }));
  const h = handPoints(lm, { width: 1000, height: 800 }, { scale: 0.5, ox: 100, oy: 20 })!;
  assert.deepEqual(h.wrist, { x: 100, y: 220 });
  assert.deepEqual(h.middleMcp, { x: 100 + (9 / 40) * 1000 * 0.5, y: 220 });
  assert.equal(handPoints(lm.slice(0, 20), { width: 1, height: 1 }, { scale: 1, ox: 0, oy: 0 }), null, 'a partial hand: nothing');
});

test('a hand found on the photo turned a quarter, a half or three quarters comes back to the photo exactly', () => {
  const corners: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.25, y: 0.75 }];
  for (const q of [0, 1, 2, 3]) for (const p of corners) {
    const back = unrotate(rotatePoint(p, q), q);
    near(back.x, p.x, 1e-9, `x after ${q}`); near(back.y, p.y, 1e-9, `y after ${q}`);
  }
  // turned 90° clockwise, the photo's top-left corner is the turned picture's top-right
  assert.deepEqual(rotatePoint({ x: 0, y: 0 }, 1), { x: 1, y: 0 });
  assert.deepEqual(unrotate({ x: 1, y: 0 }, 1), { x: 0, y: 0 });
  assert.deepEqual(rotatePoint({ x: 0.2, y: 0.1 }, 2), { x: 0.8, y: 0.9 });
});
