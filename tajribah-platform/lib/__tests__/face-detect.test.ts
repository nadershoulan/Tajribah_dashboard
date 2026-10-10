/**
 * T134.5 (face) — a face looked for harder: the photo as it is, then turned; a face found on a turned photo comes back
 * to the photo as it is shown.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFace } from '@site/lib/face-detect';
import { rotatePoint } from '@site/lib/placement';

const photo = {} as HTMLImageElement;
const eye = { x: 0.3, y: 0.4 }; // where a point is on the photo as shown

test('found as it is: no turning', async () => {
  const turns: number[] = [];
  const found = await detectFace({ detect: () => ({ faceLandmarks: [[eye]] }) }, photo, (_, q) => { turns.push(q); return photo; });
  assert.deepEqual(found, { faceLandmarks: [[eye]], quarters: 0 });
  assert.deepEqual(turns, [], 'nothing else tried');
});

test('a sideways photo: found once turned, the points brought back to the photo as shown', async () => {
  const turns: number[] = [];
  // the detector only finds the face on the photo turned three quarters, where the eye sits at rotatePoint(eye, 3)
  const detector = { detect: (img: unknown) => ((img as { q?: number }).q === 3 ? { faceLandmarks: [[{ ...rotatePoint(eye, 3), z: 0.1 }]] } : { faceLandmarks: [] }) };
  const found = await detectFace(detector, photo, (_, q) => { turns.push(q); return { q } as unknown as HTMLCanvasElement; });
  assert.deepEqual(turns, [1, 3], 'a quarter first, then three quarters');
  assert.equal(found?.quarters, 3);
  const p = found!.faceLandmarks[0]![0]!;
  assert.ok(Math.abs(p.x - eye.x) < 1e-9 && Math.abs(p.y - eye.y) < 1e-9, `back on the photo: ${p.x}, ${p.y}`);
  assert.equal(p.z, 0.1, 'its depth kept');
});

test('no face at any turn: nothing', async () => {
  assert.equal(await detectFace({ detect: () => ({ faceLandmarks: [] }) }, photo, () => photo), null);
});
