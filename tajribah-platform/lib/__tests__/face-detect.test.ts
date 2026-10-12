/**
 * T134.5 / T138 (face) — a face looked for harder: as it is, turned a quarter and three quarters (never upside down —
 * the face model fits an upside-down face wrongly), shrunk, zoomed; a face found on another look comes back to the
 * photo as it is shown; one found small is looked at once more, closer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFace } from '@site/lib/face-detect';
import { CROPS, fromCrop, type Makers, type Rect } from '@site/lib/detect-views';
import { rotatePoint } from '@site/lib/placement';

const photo = { width: 1000, height: 800 } as HTMLImageElement;
const eye = { x: 0.3, y: 0.4 }; // where a point is on the photo as shown
/** A big face (spanning most of the photo), so no closer look follows. */
const big = (p: { x: number; y: number; z?: number }) => [p, { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.95 }];

/** Stand-in pictures that say which look they are, and a record of the looks made. */
function makers(made: string[]): Makers {
  return {
    light: () => ({ brightness: 0.5, grain: 2 }),
    cleaned: () => { made.push('cleaned'); return { look: 'cleaned' } as unknown as HTMLCanvasElement; },
    turned: (_, q) => { made.push(`turned ${q}`); return { look: `turned ${q}`, width: 800, height: 1000 } as unknown as HTMLCanvasElement; },
    shrunk: () => { made.push('shrunk'); return { look: 'shrunk', width: 1000, height: 800 } as unknown as HTMLCanvasElement; },
    cropped: (_, c: Rect) => { made.push(`crop ${c.x},${c.y}`); return { look: `crop ${c.x},${c.y}`, width: 600, height: 480 } as unknown as HTMLCanvasElement; },
  };
}
const lookOf = (img: unknown) => (img as { look?: string }).look ?? 'as-is';

test('found as it is: nothing else made', async () => {
  const made: string[] = [];
  const found = await detectFace({ detect: () => ({ faceLandmarks: [big(eye)] }) }, photo, makers(made));
  assert.deepEqual(found?.faceLandmarks[0]![0], eye);
  assert.equal(found?.how, 'as-is');
  assert.deepEqual(made, [], 'no other look made');
});

test('a sideways photo: found once turned, the points brought back to the photo as shown', async () => {
  const made: string[] = [];
  const detector = { detect: (img: unknown) => (lookOf(img) === 'turned 3' ? { faceLandmarks: [big({ ...rotatePoint(eye, 3), z: 0.1 })] } : { faceLandmarks: [] }) };
  const found = await detectFace(detector, photo, makers(made));
  assert.deepEqual(made, ['turned 1', 'turned 3'], 'a quarter first, then three quarters');
  assert.equal(found?.quarters, 3);
  const p = found!.faceLandmarks[0]![0]!;
  assert.ok(Math.abs(p.x - eye.x) < 1e-9 && Math.abs(p.y - eye.y) < 1e-9, `back on the photo: ${p.x}, ${p.y}`);
  assert.equal(p.z, 0.1, 'its depth kept');
});

test('never upside down; then shrunk, then each crop, the middle first — none found: nothing', async () => {
  const made: string[] = [];
  assert.equal(await detectFace({ detect: () => ({ faceLandmarks: [] }) }, photo, makers(made)), null);
  assert.deepEqual(made, ['turned 1', 'turned 3', 'shrunk', ...CROPS.map((c) => `crop ${c.x},${c.y}`)], 'no half turn: an upside-down face is fitted wrongly');
});

test('a face far away, found in a crop: back on the photo, then looked at once more, closer', async () => {
  const made: string[] = [];
  const corner = CROPS[2]!; // the top-right crop
  const cornerLook = `crop ${corner.x},${corner.y}`;
  const standard = new Set(CROPS.map((c) => `crop ${c.x},${c.y}`));
  const small = [{ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.56 }]; // small within the crop
  const detector = {
    detect: (img: unknown) => {
      const look = lookOf(img);
      if (look === cornerLook) return { faceLandmarks: [small] };
      if (look.startsWith('crop ') && !standard.has(look)) return { faceLandmarks: [[{ x: 0.5, y: 0.5 }]] }; // the closer crop
      return { faceLandmarks: [] };
    },
  };
  const found = await detectFace(detector, photo, makers(made));
  assert.equal(found?.how, 'zoomed');
  assert.equal(found?.closer, true);
  assert.equal(made.length, 3 + CROPS.indexOf(corner) + 1 + 1, 'the looks up to that crop, then one closer crop');
  const a = fromCrop(small[0]!, corner), b = fromCrop(small[1]!, corner);
  const p = found!.faceLandmarks[0]![0]!;
  assert.ok(Math.abs(p.x - (a.x + b.x) / 2) < 0.01 && Math.abs(p.y - (a.y + b.y) / 2) < 0.01, `the closer crop is centred on the face: ${p.x}, ${p.y}`);
});
