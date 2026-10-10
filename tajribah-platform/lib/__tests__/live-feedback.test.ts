/**
 * T134.4 — what the camera guide says while it looks: nothing yet, come closer, show more, ready; and the product
 * following the hand smoothly. Hands are drawn from adult measures, as in the placement tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faceFeedback, follow, handFeedback, FAR_FACE } from '@site/lib/live-feedback';
import { KNUCKLE_SPAN_MM, PALM_LENGTH_MM, type FacePoints, type HandPoints, type Pt } from '@site/lib/placement';

/** A hand with its wrist at `at`, fingers pointing along `deg` (−90 = up), drawn at `pxPerMm`. */
function hand(at: Pt, deg: number, pxPerMm: number): HandPoints {
  const r = (deg * Math.PI) / 180, ux = Math.cos(r), uy = Math.sin(r), vx = -uy, vy = ux;
  const p = (along: number, across: number): Pt => ({ x: at.x + (ux * along + vx * across) * pxPerMm, y: at.y + (uy * along + vy * across) * pxPerMm });
  const half = KNUCKLE_SPAN_MM / 2;
  return {
    wrist: p(0, 0), middleMcp: p(PALM_LENGTH_MM, 0), middlePip: p(PALM_LENGTH_MM + 30, 0),
    indexMcp: p(PALM_LENGTH_MM - 4, -half), pinkyMcp: p(PALM_LENGTH_MM - 10, half),
    ringMcp: p(PALM_LENGTH_MM - 6, half * 0.6), ringPip: p(PALM_LENGTH_MM + 22, half * 0.65),
  };
}
const phone = { width: 390, height: 844 };

test('a hand: nothing found, too far, the product’s place cut off, ready', () => {
  assert.equal(handFeedback('watch', null, phone), 'none');
  assert.equal(handFeedback('watch', hand({ x: 195, y: 500 }, -90, 0.5), phone), 'far', 'a hand 29 px across the knuckles on a phone screen');
  assert.equal(handFeedback('watch', hand({ x: 195, y: 560 }, -90, 2), phone), 'ready', 'fingers up, the wrist and the forearm above the bottom edge');
  assert.equal(handFeedback('watch', hand({ x: 195, y: 800 }, -90, 2), phone), 'edge', 'the wrist just in, but the watch’s place on the arm below it off the screen');
  assert.equal(handFeedback('ring', hand({ x: 195, y: 560 }, -90, 2), phone), 'ready');
  assert.equal(handFeedback('ring', hand({ x: 195, y: 250 }, -90, 2), phone), 'edge', 'the ring finger’s joints off the top');
  assert.equal(handFeedback('bag', hand({ x: 195, y: 300 }, 90, 2), phone), 'ready', 'the arm down, fingers pointing down');
});

test('a face: nothing found, too far, cut off, ready', () => {
  const face = (cx: number, cy: number, ipd: number): FacePoints => ({ leftPupil: { x: cx - ipd / 2, y: cy }, rightPupil: { x: cx + ipd / 2, y: cy }, chin: { x: cx, y: cy + ipd * 1.9 } });
  assert.equal(faceFeedback(null, phone), 'none');
  assert.equal(faceFeedback(face(195, 400, phone.width * FAR_FACE * 0.8), phone), 'far');
  assert.equal(faceFeedback(face(195, 400, 110), phone), 'ready');
  assert.equal(faceFeedback(face(195, 700, 110), phone), 'edge', 'the chin below the screen');
});

test('following: part of the way each sighting, the angle the short way round', () => {
  const a = { x: 0, y: 0, width: 100, angle: 170 };
  assert.deepEqual(follow(null, a), a, 'the first sighting: straight there');
  const b = follow(a, { x: 100, y: 0, width: 200, angle: -170 }, 0.5);
  assert.equal(b.x, 50); assert.equal(b.width, 150);
  assert.ok(Math.abs(b.angle - 180) < 1e-9, `170° to −170° goes through 180°, not back through 0° (got ${b.angle})`);
});
