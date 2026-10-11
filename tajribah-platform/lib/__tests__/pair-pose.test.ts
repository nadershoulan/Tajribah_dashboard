/**
 * T134.7 — the shopper's own fit travels with the photo to the computer: as shares of the photo, checked both ways,
 * drawn on the studio's stage where the photo is shown whole.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poseFromHeader, poseHeader, poseOnStage } from '@site/lib/pair-pose';

test('a pose on the phone’s photo becomes shares of it, and comes back the same', () => {
  const header = poseHeader({ x: 540, y: 960, width: 216, angle: -94.5 }, { width: 1080, height: 1440 });
  assert.equal(header, '0.5,0.6667,0.2,-94.5');
  assert.deepEqual(poseFromHeader(header), { x: 0.5, y: 0.6667, width: 0.2, angle: -94.5 });
});

test('anything else is refused: the computer then places it itself', () => {
  for (const bad of [null, '', '1,2,3', '0.5,0.5,0.2,0,9', '0.5,0.5,0,0', '0.5,0.5,-0.2,0', '0.5,0.5,4,0', '2,0.5,0.2,0', '0.5,0.5,0.2,9999', 'a,b,c,d', '0.5,0.5,0.2,1e3', '0.5,0.5,0.2,' + '1'.repeat(120)]) {
    assert.equal(poseFromHeader(bad), null, String(bad));
  }
  assert.deepEqual(poseFromHeader('-0.1,1.2,0.3,10'), { x: -0.1, y: 1.2, width: 0.3, angle: 10 }, 'dragged a little past the edge is kept');
});

test('on the stage the photo is drawn whole and centred: the pose lands on the same spot of it', () => {
  // a 3:4 portrait photo on the 1200 × 1050 stage: 787.5 × 1050, starting 206.25 from the left
  const p = poseOnStage({ x: 0.5, y: 0.25, width: 0.2, angle: 30 }, { width: 1080, height: 1440 }, { W: 1200, H: 1050 });
  assert.ok(Math.abs(p.x - 600) < 1e-9 && Math.abs(p.y - 262.5) < 1e-9, `${p.x}, ${p.y}`);
  assert.ok(Math.abs(p.width - 157.5) < 1e-9);
  assert.equal(p.angle, 30);
});
