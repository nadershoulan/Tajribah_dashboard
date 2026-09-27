/**
 * P3.8 — the editor's preview and the saved file turn the model the same way, for every
 * combination of 90° steps; sizes after a turn swap sides and never grow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnQuaternion, turnedSize, viewerOrientation, type Turn } from '@/lib/model-turn';

type Q = [number, number, number, number];
const mul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const about = (rad: number, i: 0 | 1 | 2): Q => { const q: Q = [0, 0, 0, Math.cos(rad / 2)]; q[i] = Math.sin(rad / 2); return q; };
/** three.js `new Euler(pitch, yaw, roll, 'YXZ')` as a quaternion — what `<model-viewer>` applies. */
function viewerQuaternion(orientation: string): Q {
  const [roll, pitch, yaw] = orientation.split(' ').map((v) => (parseFloat(v) * Math.PI) / 180) as [number, number, number];
  return mul(about(yaw, 1), mul(about(pitch, 0), about(roll, 2)));
}
/** Same rotation: q and -q are one rotation. */
const same = (a: Q, b: Q) => Math.abs(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) - 1) < 1e-9;

test('a single turn is the textbook quaternion', () => {
  const h = Math.SQRT1_2;
  const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-12);
  assert.ok(close(turnQuaternion(90, 0, 0), [h, 0, 0, h]));
  assert.ok(close(turnQuaternion(0, 90, 0), [0, h, 0, h]));
  assert.ok(close(turnQuaternion(0, 0, 180), [0, 0, 1, 0]));
  assert.deepEqual(turnQuaternion(0, 0, 0), [0, 0, 0, 1]);
});

test('what the viewer previews is what the file will do, for all 64 combinations', () => {
  const steps: Turn[] = [0, 90, 180, 270];
  let checked = 0;
  for (const x of steps) for (const y of steps) for (const z of steps) {
    const orientation = viewerOrientation({ x, y, z });
    assert.ok(same(viewerQuaternion(orientation), turnQuaternion(x, y, z)), `x${x} y${y} z${z} → ${orientation}`);
    checked++;
  }
  assert.equal(checked, 64);
});

test('sizes after a turn: 90° swaps two sides, 180° changes nothing, never larger', () => {
  const bottle: [number, number, number] = [109, 260, 109];
  assert.deepEqual(turnedSize(bottle, { x: 90, y: 0, z: 0 }), [109, 109, 260], 'tipped forward: its height becomes its depth');
  assert.deepEqual(turnedSize(bottle, { x: 0, y: 0, z: 90 }), [260, 109, 109], 'rolled sideways: its height becomes its width');
  assert.deepEqual(turnedSize(bottle, { x: 180, y: 0, z: 0 }), bottle);
  assert.deepEqual(turnedSize([40, 10, 30], { x: 0, y: 90, z: 0 }), [30, 10, 40]);
  // Order matters: tipped forward first, then spun — the height ends up across.
  assert.deepEqual(turnedSize(bottle, { x: 90, y: 90, z: 0 }), [260, 109, 109], 'x first, then y (the other order leaves it front to back)');
});
