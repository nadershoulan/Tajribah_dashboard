/**
 * P1.13 — make an uploaded GLB small enough for a phone on a mobile network.
 *
 * `gltf-transform` (the plan's choice, §5): drop what nothing uses (`prune`), merge what is
 * duplicated (`dedup`), share identical vertices (`weld`), then meshopt compression
 * (`EXT_meshopt_compression`), which `<model-viewer>` decodes out of the box.
 *
 * `weld` and `dedup` are for the phone's GPU more than for the download: an unindexed
 * export can shrink to a fifth of its vertices, and meshopt's vertex-cache reordering only
 * works on indexed geometry. On a synthetic flat grid the welded file came out *larger*
 * (meshopt compresses exact duplicates very well); real exports are almost always indexed. Draco is not
 * used for now — T14 says why.
 *
 * **Two GLBs from one upload.** The web file (above) is for `<model-viewer>`. Android's Scene
 * Viewer reads neither meshopt nor KTX2 — its documented extensions are `KHR_materials_unlit`
 * and `KHR_texture_transform`, textures PNG/JPEG up to 2048 px, one UV set per mesh — so a
 * second, plain `native` GLB is made for it (and is what the USDZ is converted from, since
 * Quick Look cannot read those either). When a model cannot be made plain (a KTX2 texture
 * nothing here can decode), there is no native file and Android uses the in-page viewer.
 *
 * Pure: bytes in, bytes and facts out. No storage, no database — `process.ts` does that.
 */
import { Document, getBounds, WebIO, type Material } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument, dedup, dequantize, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { MODEL_TARGET_BYTES } from '@/lib/model-size';

/** Shared with the screens (lib/model-size.ts). */
export const TARGET_BYTES = MODEL_TARGET_BYTES;

export type ModelStats = {
  polyCount: number;
  materialCount: number;
  textureCount: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number] } | null;
};

/** What Scene Viewer documents it reads (developers.google.com/ar/develop/scene-viewer). */
export const NATIVE_EXTENSIONS: readonly string[] = ['KHR_materials_unlit', 'KHR_texture_transform'];
/** Scene Viewer's texture limit; Quick Look is happy with it too. */
export const NATIVE_MAX_TEXTURE = 2048;

/**
 * `bytes`: the web GLB. `native`: the plain GLB, and its document (the USDZ is built from it),
 * or why there is none.
 */
export type Optimized = {
  bytes: Uint8Array;
  stats: ModelStats;
  native: { bytes: Uint8Array; doc: Document } | { skipped: string };
};

/** Thrown for a file that cannot be read as glTF: retrying will never help. */
export class UnreadableModelError extends Error {}

async function io(): Promise<WebIO> {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

export async function readModel(bytes: Uint8Array): Promise<Document> {
  try {
    return await (await io()).readBinary(bytes);
  } catch (error) {
    throw new UnreadableModelError(`the GLB could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function optimizeGlb(original: Uint8Array): Promise<Optimized> {
  const doc = await readModel(original);
  let plain: Document;
  try {
    await doc.transform(prune(), dedup(), weld());
    plain = cloneDocument(doc); // before meshopt: the native file must not carry it
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  } catch (error) {
    throw new UnreadableModelError(`the GLB could not be optimised: ${error instanceof Error ? error.message : String(error)}`);
  }
  const bytes = await (await io()).writeBinary(doc);
  const skipped = await makeNative(plain);
  const native = skipped ? { skipped } : { bytes: await (await io()).writeBinary(plain), doc: plain };
  return { bytes, stats: statsOf(doc), native };
}

/**
 * Turn `doc` into what Scene Viewer reads, in place. Returns why that is impossible, or null.
 * Geometry compression was undone on read; its extensions are dropped so writing does not
 * compress again. Textures: PNG/JPEG kept (scaled to fit 2048), WebP turned into PNG, anything
 * else (KTX2, AVIF) refused — nothing here decodes it.
 */
async function makeNative(doc: Document): Promise<string | null> {
  const root = doc.getRoot();
  const used = (name: string) => root.listExtensionsUsed().find((e) => e.extensionName === name);
  used('EXT_meshopt_compression')?.dispose();
  used('KHR_meshopt_compression')?.dispose();
  if (used('KHR_mesh_quantization')) {
    await doc.transform(dequantize());
    used('KHR_mesh_quantization')?.dispose();
  }

  // One UV set per mesh is a hard limit: drop the others, and any texture that read them.
  for (const material of root.listMaterials()) dropTexturesOnLaterUvs(material);
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) {
        if (/^TEXCOORD_[1-9]\d*$/.test(semantic)) primitive.setAttribute(semantic, null);
      }
    }
  }
  await doc.transform(prune());

  for (const texture of root.listTextures()) {
    const mime = texture.getMimeType();
    const image = texture.getImage();
    if (!image) continue;
    if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') {
      return `a texture is ${mime || 'in an unknown format'}, which Scene Viewer cannot read and we cannot convert`;
    }
    const meta = await sharp(image).metadata();
    const tooBig = Math.max(meta.width ?? 0, meta.height ?? 0) > NATIVE_MAX_TEXTURE;
    if (mime === 'image/webp' || tooBig) {
      const resized = sharp(image).resize({ width: NATIVE_MAX_TEXTURE, height: NATIVE_MAX_TEXTURE, fit: 'inside', withoutEnlargement: true });
      const jpeg = mime === 'image/jpeg'; // a JPEG has no alpha to keep; everything else becomes PNG
      const out = jpeg ? await resized.jpeg({ quality: 90 }).toBuffer() : await resized.png().toBuffer();
      texture.setImage(new Uint8Array(out)).setMimeType(jpeg ? 'image/jpeg' : 'image/png');
      if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.[a-z0-9]+$/i, jpeg ? '.jpg' : '.png'));
    }
  }
  used('EXT_texture_webp')?.dispose();

  const required = root.listExtensionsUsed().filter((e) => e.isRequired() && !NATIVE_EXTENSIONS.includes(e.extensionName));
  if (required.length) return `it needs ${required.map((e) => e.extensionName).join(', ')}, which Scene Viewer cannot read`;
  return null;
}

function dropTexturesOnLaterUvs(material: Material): void {
  if ((material.getBaseColorTextureInfo()?.getTexCoord() ?? 0) > 0) material.setBaseColorTexture(null);
  if ((material.getEmissiveTextureInfo()?.getTexCoord() ?? 0) > 0) material.setEmissiveTexture(null);
  if ((material.getNormalTextureInfo()?.getTexCoord() ?? 0) > 0) material.setNormalTexture(null);
  if ((material.getOcclusionTextureInfo()?.getTexCoord() ?? 0) > 0) material.setOcclusionTexture(null);
  if ((material.getMetallicRoughnessTextureInfo()?.getTexCoord() ?? 0) > 0) material.setMetallicRoughnessTexture(null);
}

/**
 * Triangles **as drawn**: walked through the scene, so a mesh used by two nodes counts twice
 * (after `dedup` it is stored once but still rendered twice — render cost is the point).
 * Points and lines count their own primitives. Plus materials, textures and bounds.
 */
export function statsOf(doc: Document): ModelStats {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let polyCount = 0;
  scene?.traverse((node) => {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0;
      polyCount += primitive.getMode() === 4 ? Math.floor(count / 3) : count; // 4 = TRIANGLES
    }
  });
  let boundingBox: ModelStats['boundingBox'] = null;
  if (scene) {
    const { min, max } = getBounds(scene);
    if (min.every(Number.isFinite) && max.every(Number.isFinite)) boundingBox = { min: [...min] as [number, number, number], max: [...max] as [number, number, number] };
  }
  return { polyCount, materialCount: root.listMaterials().length, textureCount: root.listTextures().length, boundingBox };
}
