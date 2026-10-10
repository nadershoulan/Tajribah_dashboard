/**
 * T134.6 — the store's placement on the model photos: strict on save (each problem named), lenient on read (a bad entry
 * dropped, the built-in place used), the product kept inside its zone, the zone's frame dragged like the crop frame.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_ZONE, MODEL_IDS, dragZone, inZone, parsePlacement, placementOf, type ModelSpot } from '@/lib/tryon-placement';
import { DEFAULT_ZONES, STAGE, modelsFor, type TryOnProduct } from '@site/lib/demo-product';
import { tryOnProductFrom } from '@site/lib/tryon-config';
import type { TryOnKind } from '@/lib/tryon';

const WRIST: ModelSpot = { zone: { x: 250, y: 530, w: 180, h: 40 }, pose: { x: 340, y: 550, angle: 2, scale: 1 } };

test('saving: a spot per model photo of this kind; every problem named; empty is the built-in place', () => {
  assert.deepEqual(parsePlacement('watch', { wrist: WRIST }), { placement: { wrist: WRIST }, problems: {} });
  assert.deepEqual(parsePlacement('watch', null), { placement: null, problems: {} });
  assert.deepEqual(parsePlacement('watch', {}), { placement: null, problems: {} });
  const bad = parsePlacement('watch', {
    face: WRIST, // a watch is not shown on the face photo
    lifestyle: { ...WRIST, zone: { x: 1100, y: 500, w: 200, h: 40 } }, // off the photo
    wrist: { ...WRIST, pose: { ...WRIST.pose, x: 600 } }, // outside its zone
  });
  assert.deepEqual(Object.keys(bad.problems).sort(), ['face', 'lifestyle', 'wrist']);
  assert.equal(bad.placement, null);
  for (const [why, spot] of [
    ['tiny zone (the product inside it)', { zone: { x: 335, y: 545, w: MIN_ZONE - 1, h: 10 }, pose: { ...WRIST.pose, x: 340, y: 550 } }],
    ['a zone running off the photo (the product inside it)', { zone: { x: 1100, y: 500, w: 200, h: 40 }, pose: { ...WRIST.pose, x: 1150, y: 520 } }],
    ['too big', { ...WRIST, pose: { ...WRIST.pose, scale: 2.5 } }],
    ['too small', { ...WRIST, pose: { ...WRIST.pose, scale: 0.4 } }],
    ['turned too far', { ...WRIST, pose: { ...WRIST.pose, angle: 200 } }],
    ['not numbers', { ...WRIST, pose: { ...WRIST.pose, x: '340' } }],
  ] as const) assert.ok(parsePlacement('watch', { wrist: spot }).problems.wrist, why);
  assert.ok(parsePlacement('watch', [WRIST]).problems.placement, 'a list is not a map');
});

test('reading: only the good entries for the kind; nothing good is no placement — and the studio’s product carries it', () => {
  assert.deepEqual(placementOf('watch', { wrist: WRIST, face: WRIST, lifestyle: { zone: 1 } }), { wrist: WRIST });
  assert.equal(placementOf('glasses', { wrist: WRIST }), null);
  assert.equal(placementOf('watch', 'x'), null);
  const config = { v: 1, product: { name: 'Oyster' }, tryon: { worn: 'https://cdn.example.test/w.png', flat: 'https://cdn.example.test/f.png', caseMm: 38, placement: { wrist: WRIST, ear: WRIST } } };
  assert.deepEqual(tryOnProductFrom(config)?.placement, { wrist: WRIST }, 'a watch’s own photos only');
  assert.equal(tryOnProductFrom({ ...config, tryon: { ...config.tryon, placement: undefined } })?.placement, undefined, 'none set: none carried — the built-in places');
});

test('the product’s centre stays in its zone; the frame’s edges, corners and middle move as dragged, never off the photo', () => {
  const z = { x: 100, y: 100, w: 200, h: 100 };
  assert.deepEqual(inZone({ x: 50, y: 150 }, z), { x: 100, y: 150 });
  assert.deepEqual(inZone({ x: 350, y: 500 }, z), { x: 300, y: 200 });
  assert.deepEqual(dragZone(z, 'e', 30, 99), { x: 100, y: 100, w: 230, h: 100 }, 'an edge moves one side only');
  assert.deepEqual(dragZone(z, 'nw', -20, -10), { x: 80, y: 90, w: 220, h: 110 }, 'a corner two');
  assert.deepEqual(dragZone(z, 'move', 2000, -500), { x: STAGE.W - 200, y: 0, w: 200, h: 100 }, 'moved whole, stopping at the photo’s edges');
  assert.deepEqual(dragZone(z, 'w', 500, 0), { x: 300 - MIN_ZONE, y: 100, w: MIN_ZONE, h: 100 }, 'never smaller than the smallest zone');
  assert.deepEqual(dragZone(z, 's', 0, 5000), { x: 100, y: 100, w: 200, h: STAGE.H - 100 });
});

test('every model photo’s own place is a valid spot: the editor starts from what the studio already does', () => {
  const CATEGORY: Record<TryOnKind, TryOnProduct['category']> = { watch: undefined, glasses: 'eyewear', ring: 'ring', necklace: 'necklace', earring: 'earring', bag: 'bag' };
  for (const kind of Object.keys(MODEL_IDS) as TryOnKind[]) {
    const { models } = modelsFor({ category: CATEGORY[kind] } as TryOnProduct);
    assert.deepEqual(models.map((m) => m.id), [...MODEL_IDS[kind]], `${kind}: the same photos as the studio`);
    for (const m of models) {
      const spot = { zone: DEFAULT_ZONES[m.id], pose: { x: m.pose.x, y: m.pose.y, angle: m.pose.angle, scale: 1 } };
      assert.deepEqual(parsePlacement(kind, { [m.id]: spot }).problems, {}, `${kind} on ${m.id}`);
    }
  }
});
