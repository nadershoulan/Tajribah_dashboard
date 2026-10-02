/**
 * P1.13b — the iPhone file, made from the plain GLB. What Quick Look needs from the package (Pixar's
 * USDZ rules: the scene layer first, every file stored uncompressed and starting on a 64-byte
 * boundary, CRCs right) and from the scene (metres, Y up, the node transforms, UVs counted from the
 * bottom, the materials and which texture feeds which input). Checked for real on the Khronos
 * WaterBottle with Pixar's own ARKit compliance checker (STATE, 2026-10-01); this keeps it so.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { inspect } from '@/server/modules/models/inspect';
import { optimizeGlb } from '@/server/modules/models/optimize';
import { crc32, toUsdz, UsdzError, zipStored } from '@/server/modules/models/usdz';

type ZipEntry = { name: string; method: number; dataOffset: number; size: number; crc: number; localCrc: number; data: Uint8Array };

/** Read a zip the way a strict reader does: central directory, then each local header. */
function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.byteLength - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'central directory header');
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50, `${name}: local header`);
    const dataOffset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const size = view.getUint32(at + 20, true);
    entries.push({ name, method: view.getUint16(at + 10, true), dataOffset, size, crc: view.getUint32(at + 16, true), localCrc: view.getUint32(local + 14, true), data: bytes.subarray(dataOffset, dataOffset + size) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const png = async (w: number, h: number, alpha = false) => new Uint8Array(await sharp({
  create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 200, g: 40, b: 40, alpha: 0.5 } : '#c83232', noise: { type: 'gaussian', mean: 128, sigma: 30 } },
}).png().toBuffer());

/** Two nested nodes (moved and turned), a textured quad with every map, an untextured triangle, a line. */
async function scene(): Promise<Document> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const tex = async (name: string, alpha = false) => doc.createTexture(name).setImage(await png(8, 8, alpha)).setMimeType('image/png');
  const paint = doc.createMaterial('paint')
    .setBaseColorFactor([1, 0.5, 0.25, 1]).setBaseColorTexture(await tex('base', true)).setAlphaMode('MASK').setAlphaCutoff(0.4)
    .setMetallicFactor(0.3).setRoughnessFactor(0.6).setMetallicRoughnessTexture(await tex('mr'))
    .setNormalTexture(await tex('normal')).setNormalScale(0.5).setOcclusionTexture(await tex('ao'))
    .setEmissiveFactor([1, 1, 0]).setEmissiveTexture(await tex('glow')).setDoubleSided(true);
  paint.getBaseColorTextureInfo()!.setWrapS(33071); // clamp
  const quad = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array([0, 0, 1, 0, 1, 0.25, 0, 1])))
    .setIndices(acc('SCALAR', new Uint16Array([0, 1, 2, 0, 2, 3])))
    .setMaterial(paint);
  const plain = doc.createMaterial('plain').setBaseColorFactor([0.1, 0.2, 0.3, 0.5]).setAlphaMode('BLEND');
  const tri = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', new Float32Array([0, 0, 0, 0, 0, 1, 0, 1, 0]))).setMaterial(plain);
  const line = doc.createPrimitive().setMode(1).setAttribute('POSITION', acc('VEC3', new Float32Array([0, 0, 0, 1, 1, 1, 2, 0, 0, 3, 1, 0])));
  const child = doc.createNode('child').setMesh(doc.createMesh().addPrimitive(tri).addPrimitive(line)).setTranslation([0, 0.5, 0]);
  const parent = doc.createNode('parent').setMesh(doc.createMesh().addPrimitive(quad)).setTranslation([2, 3, 4]).setRotation([0, 1, 0, 0]).addChild(child);
  const s = doc.createScene().addChild(parent);
  doc.getRoot().setDefaultScene(s);
  return doc;
}

test('the package is what Quick Look reads: the scene layer first, every file stored, on a 64-byte boundary, CRCs right', async () => {
  const doc = await scene();
  const usdz = toUsdz(doc);
  assert.equal(inspect('usdz', usdz, usdz.byteLength), null, 'our own upload check accepts it as a USDZ');
  const entries = readZip(usdz);
  assert.equal(entries[0]!.name, 'model.usda', 'the layer first');
  assert.deepEqual(entries.slice(1).map((e) => e.name), ['textures/Texture_0.png', 'textures/Texture_1.png', 'textures/Texture_2.png', 'textures/Texture_3.png', 'textures/Texture_4.png'], 'each texture once');
  for (const e of entries) {
    assert.equal(e.method, 0, `${e.name}: stored, not compressed`);
    assert.equal(e.dataOffset % 64, 0, `${e.name}: starts on a 64-byte boundary`);
    assert.equal(e.crc, zlibCrc32(e.data), `${e.name}: CRC in the directory`);
    assert.equal(e.localCrc, e.crc, `${e.name}: and in its own header`);
  }
  assert.deepEqual(toUsdz(doc), usdz, 'the same model makes the same bytes');
});

test('the scene: metres, Y up, transforms as USD rows, UVs from the bottom, every map wired to its input', async () => {
  const text = new TextDecoder().decode(readZip(toUsdz(await scene()))[0]!.data);
  for (const line of ['defaultPrim = "Root"', 'metersPerUnit = 1', 'upAxis = "Y"', 'kind = "component"']) assert.ok(text.includes(line), line);
  // Turned 180° about Y and moved (2, 3, 4): glTF's column-major matrix, its columns as USD's rows.
  assert.ok(text.includes('matrix4d xformOp:transform = ( (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, -1, 0), (2, 3, 4, 1) )'), 'the parent');
  assert.ok(text.includes('matrix4d xformOp:transform = ( (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (0, 0.5, 0, 1) )'), 'the child, nested');
  assert.ok(/def Xform "Node_0"[\s\S]*def Xform "Node_0_0"/.test(text), 'the hierarchy kept');
  assert.ok(text.includes('texCoord2f[] primvars:st = [(0, 1), (1, 1), (1, 0.75), (0, 0)]'), 'V counted from the bottom');
  assert.ok(text.includes('int[] faceVertexIndices = [0, 1, 2, 0, 2, 3]'));
  assert.ok(text.includes('float3[] extent = [(0, 0, 0), (1, 1, 0)]'));
  assert.ok(text.includes('uniform bool doubleSided = 1'));
  assert.equal((text.match(/def Mesh /g) ?? []).length, 2, 'the line is left out; the two triangle primitives are in');

  const paint = text.slice(text.indexOf('def Material "Material_0"'), text.indexOf('def Material "Material_1"'));
  assert.ok(paint.includes('color3f inputs:diffuseColor.connect = </Root/Materials/Material_0/Texture_base.outputs:rgb>'));
  assert.ok(paint.includes('float4 inputs:scale = (1, 0.5, 0.25, 1)'), 'the base colour factor multiplies the texture');
  assert.ok(paint.includes('float inputs:opacity.connect = </Root/Materials/Material_0/Texture_base.outputs:a>'));
  assert.ok(paint.includes('float inputs:opacityThreshold = 0.4'), 'MASK');
  assert.ok(paint.includes('float inputs:metallic.connect = </Root/Materials/Material_0/Texture_mr.outputs:b>'), 'metallic is blue');
  assert.ok(paint.includes('float inputs:roughness.connect = </Root/Materials/Material_0/Texture_mr.outputs:g>'), 'roughness is green');
  assert.ok(paint.includes('float4 inputs:scale = (1, 0.6, 0.3, 1)'), 'their factors');
  assert.ok(paint.includes('float4 inputs:scale = (1, 1, 2, 1)') && paint.includes('float4 inputs:bias = (-0.5, -0.5, -1, 0)'), 'the normal map, its scale 0.5');
  assert.ok(paint.includes('float inputs:occlusion.connect = </Root/Materials/Material_0/Texture_occlusion.outputs:r>'));
  assert.ok(paint.includes('color3f inputs:emissiveColor.connect = </Root/Materials/Material_0/Texture_emissive.outputs:rgb>'));
  assert.equal((paint.match(/sourceColorSpace = "sRGB"/g) ?? []).length, 2, 'base colour and emissive are colours');
  assert.equal((paint.match(/sourceColorSpace = "raw"/g) ?? []).length, 3, 'the rest are data');
  assert.ok(paint.includes('token inputs:wrapS = "clamp"'));
  assert.ok(paint.includes('string inputs:varname = "st"'));

  const plain = text.slice(text.indexOf('def Material "Material_1"'));
  assert.ok(plain.includes('color3f inputs:diffuseColor = (0.1, 0.2, 0.3)') && plain.includes('float inputs:opacity = 0.5'), 'BLEND, untextured');
  assert.ok(!plain.includes('PrimvarReader'), 'no UV reader where nothing reads UVs');
  assert.ok(!text.includes('NaN') && !text.includes('-0,'), 'plain numbers');
});

test('a model with nothing to show makes no file; a texture Quick Look cannot read falls back to its factor', async () => {
  const empty = new Document();
  empty.getRoot().setDefaultScene(empty.createScene().addChild(empty.createNode('nothing')));
  assert.throws(() => toUsdz(empty), UsdzError);

  const doc = new Document();
  const buffer = doc.createBuffer();
  const webp = doc.createTexture('w').setImage(new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).webp().toBuffer())).setMimeType('image/webp');
  const material = doc.createMaterial('m').setBaseColorFactor([0.2, 0.4, 0.6, 1]).setBaseColorTexture(webp);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array([0, 0, 1, 0, 0, 1])).setBuffer(buffer))
    .setMaterial(material);
  doc.getRoot().setDefaultScene(doc.createScene().addChild(doc.createNode('n').setMesh(doc.createMesh().addPrimitive(prim))));
  const entries = readZip(toUsdz(doc));
  assert.equal(entries.length, 1, 'no WebP in the package');
  assert.ok(new TextDecoder().decode(entries[0]!.data).includes('color3f inputs:diffuseColor = (0.2, 0.4, 0.6)'));
});

test('from an upload: the plain GLB the optimiser makes becomes a USDZ of the same size', async () => {
  const src = await scene();
  const { WebIO } = await import('@gltf-transform/core');
  const optimized = await optimizeGlb(await new WebIO().writeBinary(src));
  assert.ok('doc' in optimized.native);
  const text = new TextDecoder().decode(readZip(toUsdz(optimized.native.doc))[0]!.data);
  assert.ok(text.includes('(2, 3, 4, 1)'), 'the transform survives optimisation');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
  assert.equal(zipStored([]).byteLength, 22, 'an empty package is only its end record');
});
