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
 * used for now — T14 says why. Textures are passed through untouched: KTX2 needs a native
 * encoder and waits on P1.13b.
 *
 * Pure: bytes in, bytes and facts out. No storage, no database — `process.ts` does that.
 */
import { Document, getBounds, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { MODEL_TARGET_BYTES } from '@/lib/model-size';

/** Shared with the screens (lib/model-size.ts). */
export const TARGET_BYTES = MODEL_TARGET_BYTES;

export type ModelStats = {
  polyCount: number;
  materialCount: number;
  textureCount: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number] } | null;
};

export type Optimized = { bytes: Uint8Array; stats: ModelStats };

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
  try {
    await doc.transform(prune(), dedup(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  } catch (error) {
    throw new UnreadableModelError(`the GLB could not be optimised: ${error instanceof Error ? error.message : String(error)}`);
  }
  const bytes = await (await io()).writeBinary(doc);
  return { bytes, stats: statsOf(doc) };
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
