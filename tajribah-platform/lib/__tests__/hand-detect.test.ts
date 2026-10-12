/**
 * T134.5 / T138 — a hand looked for harder: as it is, turned (a quarter, three quarters, a half), shrunk, zoomed, and a
 * weaker sighting last; its points come back to the photo; one found small is looked at once more, closer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectHand } from '@site/lib/hand-detect';
import { CROPS, fromShrunk, type Makers, type Rect } from '@site/lib/detect-views';

const photo = { width: 1000, height: 800 } as HTMLImageElement;
const bigHand = (p: { x: number; y: number }) => [p, { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }];
function makers(made: string[]): Makers {
  return {
    light: () => ({ brightness: 0.5, grain: 2 }),
    cleaned: () => { made.push('cleaned'); return { look: 'cleaned' } as unknown as HTMLCanvasElement; },
    turned: (_, q) => { made.push(`turned ${q}`); return { look: `turned ${q}` } as unknown as HTMLCanvasElement; },
    shrunk: () => { made.push('shrunk'); return { look: 'shrunk' } as unknown as HTMLCanvasElement; },
    cropped: (_, c: Rect) => { made.push(`crop ${c.x},${c.y}`); return { look: `crop ${c.x},${c.y}` } as unknown as HTMLCanvasElement; },
  };
}
const lookOf = (img: unknown) => (img as { look?: string }).look ?? 'as-is';

test('every look in order — the half turn too (a hand may point down) — then a weaker sighting, then nothing', async () => {
  const made: string[] = [], options: number[] = [];
  const detector = { detect: () => ({ landmarks: [] }), setOptions: async (o: { minHandDetectionConfidence?: number }) => { options.push(o.minHandDetectionConfidence!); } };
  assert.equal(await detectHand(detector, photo, { make: makers(made) }), null);
  assert.deepEqual(made, ['turned 1', 'turned 3', 'turned 2', 'shrunk', ...CROPS.map((c) => `crop ${c.x},${c.y}`)]);
  assert.deepEqual(options, [0.15, 0.35], 'the weaker sighting last, and the detector put back');
});

test('a hand too close: found once shrunk, back on the photo, with the detector’s own score', async () => {
  const made: string[] = [];
  const onShrunk = { x: 0.5, y: 0.62 };
  const detector = { detect: (img: unknown) => (lookOf(img) === 'shrunk' ? { landmarks: [bigHand(onShrunk)], handedness: [[{ score: 0.9 }]] } : { landmarks: [] }) };
  const found = await detectHand(detector, photo, { make: makers(made) });
  assert.equal(found?.how, 'shrunk');
  assert.equal(found?.score, 0.9);
  assert.equal(found?.loose, false);
  const p = found!.landmarks[0]![0]!, want = fromShrunk(onShrunk);
  assert.ok(Math.abs(p.x - want.x) < 1e-9 && Math.abs(p.y - want.y) < 1e-9);
  assert.equal(made.at(-1), 'shrunk', 'nothing after it (a big hand: no closer look)');
});

test('a hand found small is looked at once more, closer; a weaker sighting counts for less', async () => {
  const made: string[] = [];
  const small = [{ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.56 }];
  const detector = { detect: (img: unknown) => (lookOf(img) === 'as-is' ? { landmarks: [small] } : lookOf(img).startsWith('crop ') ? { landmarks: [[{ x: 0.5, y: 0.5 }]] } : { landmarks: [] }) };
  const found = await detectHand(detector, photo, { make: makers(made) });
  assert.equal(found?.closer, true);
  assert.equal(made.length, 1, 'one closer crop, nothing else');
  const p = found!.landmarks[0]![0]!;
  assert.ok(Math.abs(p.x - 0.525) < 0.01 && Math.abs(p.y - 0.53) < 0.01, `the closer answer is the one kept (centred on the hand): ${p.x}, ${p.y}`);
  let loose = false;
  const weak = {
    detect: () => (loose ? { landmarks: [bigHand({ x: 0.4, y: 0.4 })], handedness: [[{ score: 0.5 }]] } : { landmarks: [] }),
    setOptions: async (o: { minHandDetectionConfidence?: number }) => { loose = o.minHandDetectionConfidence === 0.15; },
  };
  const w = await detectHand(weak, photo, { make: makers([]) });
  assert.deepEqual([w?.how, w?.loose, w?.score], ['loose', true, 0.4]);
});
