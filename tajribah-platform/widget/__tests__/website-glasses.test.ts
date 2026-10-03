/**
 * T68 — glasses in the studio (../tajribah-try-on/lib/demo-product.ts): the watch exactly as before
 * (its models, poses and base width pinned), glasses on a real face at a measured scale, and every
 * picture a real photograph recorded in ASSETS.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_GLASSES, DEMO_NECKLACE, DEMO_RING, DEMO_WATCH, FACE_MODELS, HAND_MODELS, MODELS, NECK_MODELS, constrainToModel, modelsFor } from '../../../tajribah-try-on/lib/demo-product';

const site = (p: string) => join(process.cwd(), '..', 'tajribah-try-on', p);

test('a watch is exactly as before: the same two photos, poses and base width', () => {
  const { models, baseMm } = modelsFor(DEMO_WATCH);
  assert.equal(models, MODELS);
  assert.equal(baseMm, 29.3);
  assert.deepEqual(models.map((m) => [m.id, m.pose]), [
    ['wrist', { x: 350, y: 553, width: 139, angle: 0 }],
    ['lifestyle', { x: 607, y: 492, width: 112, angle: -34 }],
  ]);
  assert.equal(DEMO_WATCH.category, undefined, 'left out means a watch');
  assert.deepEqual(constrainToModel('wrist', { x: 999, y: 0, width: 139, angle: 0 }), { x: 440, y: 542.25, width: 139, angle: 0 });
});

test('glasses sit on a real face at a measured scale: 62 mm between pupils 324 px apart', () => {
  const { models, baseMm } = modelsFor(DEMO_GLASSES);
  assert.equal(models, FACE_MODELS);
  assert.equal(baseMm, DEMO_GLASSES.caseMm);
  const pupils = [[433, 527], [757, 514]];
  const pxPerMm = Math.hypot(pupils[1]![0]! - pupils[0]![0]!, pupils[1]![1]! - pupils[0]![1]!) / 62;
  const pose = models[0]!.pose;
  assert.ok(Math.abs(pose.width - DEMO_GLASSES.caseMm * pxPerMm) < 3, `${pose.width} px for ${DEMO_GLASSES.caseMm} mm at ${pxPerMm.toFixed(2)} px/mm`);
  assert.ok(Math.abs(pose.x - (pupils[0]![0]! + pupils[1]![0]!) / 2) < 1, 'centred between the pupils');
  const tilt = (Math.atan2(pupils[1]![1]! - pupils[0]![1]!, pupils[1]![0]! - pupils[0]![0]!) * 180) / Math.PI;
  assert.ok(Math.abs(pose.angle - tilt) < 0.1, 'tilted as the eyes are');
  assert.notEqual(DEMO_GLASSES.onMe, false, 'the demo offers the shopper’s own photo: the face is found on their device');
  assert.ok(existsSync(site('public/assets/face-landmarker.task')) && statSync(site('public/assets/face-landmarker.task')).size > 3_000_000, 'the face model is served by the site');
  assert.equal(DEMO_GLASSES.demo, false, 'not Failet: no demo-store badge');
  const kept = constrainToModel('face', { x: 0, y: 0, width: 690, angle: 0 });
  assert.deepEqual([kept.x, kept.y], [555, 495], 'kept across the eyes');
});

test('every glasses picture is a real photo in the site, recorded in ASSETS.md with its licence', () => {
  const assets = readFileSync(site('ASSETS.md'), 'utf8');
  for (const file of ['model-face.webp', 'model-face-thumb.webp', 'glasses-front.png']) {
    assert.ok(existsSync(site(`public/assets/${file}`)) && statSync(site(`public/assets/${file}`)).size > 10_000, file);
    assert.match(assets, new RegExp(file.replace('.', '\\.')), `${file} in ASSETS.md`);
  }
  assert.match(assets, /unsplash\.com\/photos\/KTQN0UWNwS4/);
  assert.match(assets, /unsplash\.com\/photos\/62rTkfxLTDg/);
  assert.match(assets, /Unsplash License/);
  assert.match(readFileSync(site('preview/build.mjs'), 'utf8'), /'glasses-front\.png'/, 'the static preview carries them too');
});

test('a ring sits on a real hand at a measured scale: 79 mm across the knuckles, 953 px in the photo', () => {
  const { models, baseMm } = modelsFor(DEMO_RING);
  assert.equal(models, HAND_MODELS);
  assert.equal(baseMm, DEMO_RING.caseMm);
  const pxPerMm = (953 / 79) * (1200 / 2200); // the photo's scale, then the stage crop
  assert.ok(Math.abs(models[0]!.pose.width - DEMO_RING.caseMm * pxPerMm) < 2, `${models[0]!.pose.width} px for ${DEMO_RING.caseMm} mm`);
  assert.deepEqual([models[0]!.pose.x, models[0]!.pose.y], [Math.round((2078 - 900) * 1200 / 2200), Math.round((2400 - 1350) * 1200 / 2200)], 'on the ring finger’s base');
  assert.notEqual(DEMO_RING.onMe, false, 'the demo offers the shopper’s own hand photo');
  assert.equal(DEMO_RING.demo, false);
  const assets = readFileSync(site('ASSETS.md'), 'utf8');
  for (const file of ['model-hand.webp', 'model-hand-thumb.webp', 'ring-top.webp']) {
    assert.ok(existsSync(site(`public/assets/${file}`)) && statSync(site(`public/assets/${file}`)).size > 5_000, file);
    assert.match(assets, new RegExp(file.replace('.', '\\.')), `${file} in ASSETS.md`);
  }
  assert.match(assets, /pexels\.com\/photo\/20805371/);
  assert.match(assets, /pexels\.com\/photo\/12194367/);
  assert.deepEqual([constrainToModel('hand', { x: 0, y: 0, width: 135, angle: 0 }).x], [600]);
});

test('a necklace hangs on a real model at a measured scale: 62 mm between pupils 810 px apart in the photo', () => {
  const { models, baseMm } = modelsFor(DEMO_NECKLACE);
  assert.equal(models, NECK_MODELS);
  assert.equal(baseMm, DEMO_NECKLACE.caseMm);
  const pxPerMm = (810 / 62) * (1200 / 4480);
  assert.ok(Math.abs(models[0]!.pose.width - DEMO_NECKLACE.caseMm * pxPerMm) < 2, `${models[0]!.pose.width} px for ${DEMO_NECKLACE.caseMm} mm`);
  assert.equal(models[0]!.pose.angle, 0, 'a necklace hangs straight');
  assert.equal(DEMO_NECKLACE.onMe, false, 'finding the neck in the shopper’s photo is not built: the tab is hidden');
  const assets = readFileSync(site('ASSETS.md'), 'utf8');
  for (const file of ['model-neck.webp', 'model-neck-thumb.webp', 'necklace-front.webp']) {
    assert.ok(existsSync(site(`public/assets/${file}`)) && statSync(site(`public/assets/${file}`)).size > 3_000, file);
    assert.match(assets, new RegExp(file.replace('.', '\\.')), `${file} in ASSETS.md`);
  }
  assert.match(assets, /pexels\.com\/photo\/34900678/);
  assert.match(assets, /pexels\.com\/photo\/20768279/);
});
