/**
 * T140.4 — an earring placed by itself: from the face's outline on a photo from the front (the nearer side, inside the
 * photo, just outside the outline, sized by the pupils, hanging straight), or from the pose model's ear on a side photo;
 * nothing when neither can say (the two taps then).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EAR_EYE_MM, LOBE_OUTSIDE_MM, PIERCE_BELOW_EAR_MM, PUPIL_DISTANCE_MM, earringFromFace, earringFromPose } from '@site/lib/placement';

const img = { width: 1000, height: 1000 };
const flat = { scale: 1, ox: 0, oy: 0 };
const close = (a: number, b: number, d = 0.5) => Math.abs(a - b) < d;

/** A face from MediaPipe's points: pupils, nose, the outline beside each ear (normalised). */
function face(pts: Record<number, [number, number]>) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [i, [x, y]] of Object.entries(pts)) lm[Number(i)] = { x, y };
  return lm;
}
const front = { 468: [0.4, 0.4], 473: [0.6, 0.4], 1: [0.5, 0.5], 323: [0.72, 0.5], 361: [0.7, 0.6], 93: [0.28, 0.5], 132: [0.3, 0.6] } as Record<number, [number, number]>;

test('from the front: just outside the outline, between the ear’s middle and the lobe, sized by the pupils, hanging straight', () => {
  const s = 200 / PUPIL_DISTANCE_MM;
  const turned = face({ ...front, 323: [0.78, 0.5], 361: [0.76, 0.6] }); // turned a little: the image-right ear nearer
  const p = earringFromFace(turned, img, flat, 20, 1.5)!;
  assert.ok(close(p.x, 770 + LOBE_OUTSIDE_MM * s), `outside the outline on the nearer side: ${p.x}`);
  assert.ok(close(p.width, 20 * s), 'its real size against the pupils');
  assert.ok(close(p.y, 550 + (p.width * 1.5) / 2), 'hanging from there');
  assert.equal(p.angle, 0, 'straight down');
  const other = earringFromFace(face({ ...front, 93: [0.2, 0.5], 132: [0.22, 0.6] }), img, flat, 20, 1.5)!;
  assert.ok(other.x < 210, `the other side when that one is nearer: ${other.x}`);
});

test('never an ear cut off by the photo’s edge; no face, nothing', () => {
  const cut = face({ ...front, 323: [1.05, 0.5], 361: [1.04, 0.6], 93: [0.3, 0.5], 132: [0.32, 0.6] }); // the nearer outline off the photo
  const p = earringFromFace(cut, img, flat, 20, 1)!;
  assert.ok(p.x < 500, `the side inside the photo: ${p.x}`);
  assert.equal(earringFromFace(face({ ...front, 323: [1.1, 0.5], 361: [1.1, 0.6], 93: [-0.1, 0.5], 132: [-0.1, 0.6] }), img, flat, 20, 1), null, 'both off the photo');
  assert.equal(earringFromFace([], img, flat, 20, 1), null);
  // the photo drawn smaller on the stage: the stage's points
  const onStage = earringFromFace(face(front), img, { scale: 0.5, ox: 100, oy: 50 }, 20, 1)!;
  assert.ok(close(onStage.width, 20 * (100 / PUPIL_DISTANCE_MM)), 'sized on the stage');
});

/** The pose model's 33 points (normalised), with how visible each is. */
function pose(pts: Record<number, [number, number, number]>) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  for (const [i, [x, y, v]] of Object.entries(pts)) lm[Number(i)] = { x, y, visibility: v };
  return lm;
}

test('a side photo: the ear the pose model sees, the piercing below its middle, sized from the ear to the eye', () => {
  const side = pose({ 0: [0.3, 0.45, 0.99], 7: [0.6, 0.4, 0.95], 8: [0.62, 0.41, 0.1], 2: [0.4, 0.38, 0.9], 3: [0.37, 0.38, 0.9], 5: [0.35, 0.38, 0.2] });
  const p = earringFromPose(side, img, flat, 20, 1)!;
  const s = Math.hypot(600 - 370, 400 - 380) / EAR_EYE_MM;
  assert.ok(close(p.x, 600), 'below the ear');
  assert.ok(close(p.y, 400 + PIERCE_BELOW_EAR_MM * s + (20 * s) / 2), `${PIERCE_BELOW_EAR_MM} mm below its middle, then hanging: ${p.y}`);
  assert.ok(close(p.width, 20 * s));
  // both eyes seen and the head tilted: down the head, not the picture
  const tilted = pose({ 0: [0.5, 0.5, 0.99], 7: [0.7, 0.45, 0.9], 2: [0.6, 0.4, 0.9], 5: [0.4, 0.32, 0.9], 3: [0.62, 0.41, 0.9] });
  const q = earringFromPose(tilted, img, flat, 20, 0)!;
  assert.ok(q.x < 700, `tilted: the piercing follows the head (${q.x})`);
  // the mirrored front camera: the same
  const mirrored = pose({ 0: [0.5, 0.5, 0.99], 7: [0.3, 0.45, 0.9], 2: [0.4, 0.4, 0.9], 5: [0.6, 0.4, 0.9], 3: [0.38, 0.41, 0.9] });
  assert.ok(earringFromPose(mirrored, img, flat, 20, 0)!.y > 450, 'still below the ear');
});

test('no ear seen, or only off the photo: nothing (the two taps then)', () => {
  assert.equal(earringFromPose(pose({ 0: [0.3, 0.45, 0.99], 7: [0.6, 0.4, 0.2], 8: [0.62, 0.41, 0.1] }), img, flat, 20, 1), null);
  assert.equal(earringFromPose(pose({ 0: [0.3, 0.45, 0.99], 7: [1.2, 0.4, 0.95] }), img, flat, 20, 1), null);
  assert.equal(earringFromPose([], img, flat, 20, 1), null);
});
