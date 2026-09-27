/**
 * P3.5 ⭐ — post-processing: textures to WebP at the largest size that fits 2 MB, too many
 * triangles simplified, a generated model fitted to the product and stood on the floor.
 * (A real product model — Khronos's CC0 WaterBottle, 8.97 MB — went to 509 KB and rendered the
 * same in `<model-viewer>`; that model is not committed, so these tests build their own.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document, WebIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { optimizeGlb, TARGET_BYTES } from '@/server/modules/models/optimize';
import {
  MAX_TRIANGLES, TEXTURE_STEPS, fitToProduct, nativeTextureFormat, simplifyTo, triangleCount,
} from '@/server/modules/models/postprocess';

/** Noise, not a flat colour: a flat one compresses to nothing and proves nothing. */
const noise = async (size: number, channels: 3 | 4 = 3) =>
  new Uint8Array(await sharp({ create: { width: size, height: size, channels, background: channels === 4 ? { r: 0, g: 0, b: 0, alpha: 0.5 } : '#000', noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).png().toBuffer());

/** An n×n grid of quads (2n² triangles), indexed, spanning `size` metres in X and Y. */
function grid(doc: Document, n: number, size = 1, bump = 0): ReturnType<Document['createMesh']> {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
    positions.push((x / n) * size, (y / n) * size, bump ? Math.sin(x * 0.7) * Math.cos(y * 0.9) * bump : 0);
    uvs.push(x / n, y / n);
  }
  const indices: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x;
    indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
  }
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer));
  return doc.createMesh().addPrimitive(prim);
}

async function texturedModel(textureSize: number, options: { normal?: boolean; alpha?: boolean } = {}): Promise<Uint8Array> {
  const doc = new Document();
  doc.createBuffer();
  const mesh = grid(doc, 4);
  const material = doc.createMaterial('m')
    .setBaseColorTexture(doc.createTexture('base').setImage(await noise(textureSize, options.alpha ? 4 : 3)).setMimeType('image/png'))
    .setMetallicRoughnessTexture(doc.createTexture('orm').setImage(await noise(textureSize)).setMimeType('image/png'));
  if (options.normal) material.setNormalTexture(doc.createTexture('normal').setImage(await noise(textureSize)).setMimeType('image/png'));
  if (options.alpha) material.setAlphaMode('BLEND');
  mesh.listPrimitives()[0]!.setMaterial(material);
  const scene = doc.createScene();
  scene.addChild(doc.createNode('n').setMesh(mesh));
  doc.getRoot().setDefaultScene(scene);
  return new WebIO().writeBinary(doc);
}

const reader = async () => {
  await MeshoptDecoder.ready;
  return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
};
const textures = async (bytes: Uint8Array) => {
  const doc = await (await reader()).readBinary(bytes);
  return Promise.all(doc.getRoot().listTextures().map(async (t) => {
    const meta = await sharp(t.getImage()!).metadata();
    return { name: t.getName(), mime: t.getMimeType(), format: meta.format, width: meta.width };
  }));
};

test('textures become WebP at the largest step that fits 2 MB; the native file gets JPEG (opaque) or PNG (transparent)', async () => {
  const small = await optimizeGlb(await texturedModel(1024, { normal: true }));
  assert.equal(small.post.textureMaxPx, 1024, 'already small: kept at its own size');
  assert.ok(small.bytes.byteLength <= TARGET_BYTES);
  assert.deepEqual((await textures(small.bytes)).map((t) => [t.name, t.mime, t.format]).sort(), [
    ['base', 'image/webp', 'webp'], ['normal', 'image/webp', 'webp'], ['orm', 'image/webp', 'webp'],
  ]);
  const json = JSON.parse(new TextDecoder().decode(small.bytes.subarray(20, 20 + new DataView(small.bytes.buffer, small.bytes.byteOffset).getUint32(12, true))));
  assert.ok(json.extensionsUsed.includes('EXT_texture_webp'));
  assert.ok('bytes' in small.native);
  assert.deepEqual((await textures(small.native.bytes)).map((t) => t.mime).sort(), ['image/jpeg', 'image/jpeg', 'image/jpeg'], 'opaque: JPEG, and never WebP for Scene Viewer');

  // Three 4096 px noise textures cannot fit 2 MB at 2048: the next step down is used.
  const heavy = await optimizeGlb(await texturedModel(4096, { normal: true }));
  assert.equal(heavy.post.textureMaxPx, TEXTURE_STEPS[1]);
  assert.ok((await textures(heavy.bytes)).every((t) => t.width === TEXTURE_STEPS[1]), 'every texture at 1024');
  assert.ok('bytes' in heavy.native && (await textures(heavy.native.bytes)).every((t) => t.width === TEXTURE_STEPS[1]), 'the native file at the same step');

  const clear = await optimizeGlb(await texturedModel(256, { alpha: true }));
  assert.ok('bytes' in clear.native);
  const base = (await textures(clear.native.bytes)).find((t) => t.name === 'base');
  assert.equal(base?.mime, 'image/png', 'transparency survives in the native file');
  assert.equal(await nativeTextureFormat(await noise(32, 4)), 'png');
  assert.equal(await nativeTextureFormat(await noise(32, 3)), 'jpeg');
});

test('too many triangles are simplified toward the budget; a model under it is left alone', async () => {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene();
  scene.addChild(doc.createNode('dense').setMesh(grid(doc, 260, 1, 0.02))); // 135,200 triangles, curved
  doc.getRoot().setDefaultScene(scene);
  const before = triangleCount(doc);
  assert.ok(before > MAX_TRIANGLES);
  const result = await simplifyTo(doc);
  assert.ok(result && result.from === before);
  assert.ok(result!.to <= MAX_TRIANGLES * 1.02 && result!.to > MAX_TRIANGLES * 0.5, `${before} → ${result!.to}`);

  const light = new Document();
  light.createBuffer();
  light.createScene().addChild(light.createNode('x').setMesh(grid(light, 20)));
  assert.equal(await simplifyTo(light), null);
});

test('a generated model is fitted to the product, stood on the floor and centred; a disagreeing shape is flagged, never stretched', async () => {
  const make = () => {
    const doc = new Document();
    doc.createBuffer();
    const scene = doc.createScene();
    // 2 × 1 units, far from the origin: a generator's arbitrary scale and position.
    scene.addChild(doc.createNode('m').setMesh(grid(doc, 4, 1)).setScale([2, 1, 1]).setTranslation([5, 3, -2]));
    doc.getRoot().setDefaultScene(scene);
    return doc;
  };
  const doc = make();
  const fit = await fitToProduct(doc, { widthMm: 400, heightMm: 200 });
  assert.ok(fit.applied);
  assert.deepEqual([fit.sizeMm[0], fit.sizeMm[1], fit.proportions], [400, 200, 'match']);
  const { min, max } = getBounds(doc.getRoot().getDefaultScene()!);
  assert.ok(Math.abs(min[1]) < 1e-6, 'standing on the floor');
  assert.ok(Math.abs(min[0] + max[0]) < 1e-6 && Math.abs(min[2] + max[2]) < 1e-6, 'centred');

  const wrong = await fitToProduct(make(), { widthMm: 400, heightMm: 350 });
  assert.ok(wrong.applied);
  assert.deepEqual([wrong.sizeMm[0], wrong.sizeMm[1], wrong.proportions], [400, 200, 'differ'], 'uniform scale: the height is not forced to match');

  assert.deepEqual(await fitToProduct(make(), { widthMm: null }), { applied: false, reason: 'no_dimensions' });
  assert.deepEqual(await fitToProduct(make(), null), { applied: false, reason: 'no_dimensions' });
  const empty = new Document();
  empty.getRoot().setDefaultScene(empty.createScene());
  assert.deepEqual(await fitToProduct(empty, { widthMm: 40 }), { applied: false, reason: 'empty_model' });

  // Through the optimiser: fitted only when asked (a generated model), never for an upload.
  const bytes = await new WebIO().writeBinary(make());
  const uploaded = await optimizeGlb(bytes);
  assert.equal(uploaded.post.fit, null);
  assert.deepEqual(uploaded.stats.boundingBox?.min.map((v) => Math.round(v * 100) / 100), [5, 3, -2], 'an upload keeps its own size and place');
  const generated = await optimizeGlb(bytes, { fit: { widthMm: 400, heightMm: 200 } });
  assert.deepEqual(generated.stats.boundingBox?.max.map((v) => Math.round(v * 1000)), [200, 200, 0]);
});
