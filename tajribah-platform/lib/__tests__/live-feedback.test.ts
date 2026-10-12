/**
 * T134.4 — what the camera guide says while it looks: nothing yet, come closer, show more, ready; and the product
 * following the hand smoothly. Hands are drawn from adult measures, as in the placement tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faceFeedback, follow, handFeedback, smooth, FAR_FACE, type Smoothing } from '@site/lib/live-feedback';
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

type P = { x: number; y: number; width: number; angle: number };
/** Sightings a dozen times a second through `smooth`, and through a fixed share (`follow`, before). */
function both(sightings: (i: number) => P, n: number) {
  const seen = Array.from({ length: n }, (_, i) => sightings(i)); // the same sightings for both
  let st: Smoothing<P> = null, f: P | null = null;
  const s: P[] = [], fixed: P[] = [];
  seen.forEach((one, i) => {
    const r: { state: Smoothing<P>; pose: P } = smooth<P>(st, one, i * 83); st = r.state; s.push(r.pose);
    f = follow(f, one); fixed.push(f);
  });
  return { s, fixed };
}
const spread = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };

test('held still: the detector’s jitter smoothed away — far steadier than a fixed share', () => {
  let seed = 3;
  const jitter = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 4; }; // ±2 px, as a still hand reads
  const { s, fixed } = both(() => ({ x: 200 + jitter(), y: 400 + jitter(), width: 80 + jitter() / 2, angle: 10 + jitter() * 0.75 }), 220);
  const a = spread(s.slice(20).map((p) => p.x)), b = spread(fixed.slice(20).map((p) => p.x));
  assert.ok(a < b * 0.65, `x wobbles ${a.toFixed(2)} px, was ${b.toFixed(2)}`);
  assert.ok(spread(s.slice(20).map((p) => p.angle)) < spread(fixed.slice(20).map((p) => p.angle)) * 0.65, 'and the angle');
});

test('moving: it keeps up — no trailing behind the hand', () => {
  // the hand jumps 150 px across, then holds
  const { s, fixed } = both((i) => ({ x: i < 10 ? 100 : 250, y: 400, width: 80, angle: 0 }), 20);
  const within = (ps: P[]) => ps.slice(10).findIndex((p) => Math.abs(p.x - 250) < 15) + 1;
  assert.ok(within(s) <= 3, `there within ${within(s)} sightings (a quarter of a second)`);
  assert.ok(within(s) < within(fixed), `sooner than a fixed share (${within(fixed)})`);
  // sliding steadily across: never far behind
  const slide = both((i) => ({ x: 100 + i * 12, y: 400, width: 80, angle: 0 }), 30).s;
  assert.ok(Math.abs(slide[29]!.x - (100 + 29 * 12)) < 30, `behind by ${(100 + 29 * 12 - slide[29]!.x).toFixed(1)} px at 145 px a second`);
});

test('smoothing: straight there at first and after a gap; the angle the short way round', () => {
  const a = { x: 0, y: 0, width: 100, angle: 170 };
  const first = smooth(null, a, 0);
  assert.deepEqual(first.pose, a);
  const b = smooth(first.state, { x: 0, y: 0, width: 100, angle: -170 }, 83).pose;
  assert.ok(b.angle > 170 && b.angle <= 190, `170° to −170° goes through 180° (got ${b.angle})`);
  assert.deepEqual(smooth(first.state, { x: 300, y: 0, width: 100, angle: 0 }, 2000).pose, { x: 300, y: 0, width: 100, angle: 0 }, 'after a gap: straight to the new place');
});

