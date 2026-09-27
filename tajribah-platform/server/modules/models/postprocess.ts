/**
 * P3.5 ⭐ — post-processing: what makes a model small enough to load on a phone, and the size
 * the shopper expects to see.
 *
 * The plan: "post-processing matters more than generation quality for the business: it is what
 * keeps models under 2 MB". Measured on a real product model (Khronos's CC0 WaterBottle, 8.97
 * MB): P1.13's geometry work left it at 8.87 MB — its four 2048 px PNG textures are 99% of the
 * bytes. So, in this order:
 *
 *  1. **Fit to the product** (generated models only). A generator's output has no real size.
 *     Scaled uniformly so its longest side is the product's longest measured side, then stood
 *     on the floor and centred (`center({ pivot: 'below' })`) — where AR expects the origin.
 *     The other measurements are checked, not forced: a generated shape that disagrees with the
 *     merchant's numbers is flagged for QA review (P3.6), never stretched to match.
 *     An uploaded model is the merchant's own file and keeps its geometry as made.
 *  2. **Fewer triangles** when there are more than a phone draws comfortably (`MAX_TRIANGLES`):
 *     meshopt's simplifier, bounded by an error of 0.5% of the mesh — it stops early rather than
 *     visibly damage the shape, and the result says how far it got.
 *  3. **Textures to WebP** for the web file, at the largest of `TEXTURE_STEPS` that brings the
 *     file under 2 MB (normal maps at a higher quality: artefacts there show as dents).
 *     The native file (Scene Viewer, USDZ) cannot read WebP: opaque textures become JPEG there,
 *     at the same size step.
 *
 * Pure: documents in, documents and facts out.
 */
import type { Document, Node } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/core';
import { center, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

/** Above this, a mid-range phone starts to stutter while the shopper turns the model. */
export const MAX_TRIANGLES = 100_000;
/** Simplification never moves the surface more than this fraction of the mesh's size. */
export const SIMPLIFY_ERROR = 0.005;
/** Texture sizes tried, largest first; below 1024 a product's print and stitching blur. */
export const TEXTURE_STEPS = [2048, 1024] as const;
export const WEBP_QUALITY = 82;
export const NORMAL_WEBP_QUALITY = 92;
/** A generated shape within this ratio of the merchant's measurement agrees with it. */
export const PROPORTION_TOLERANCE = 0.15;

export type ProductSize = { widthMm?: number | null; heightMm?: number | null; depthMm?: number | null };

export type FitResult =
  | { applied: true; scale: number; sizeMm: [number, number, number]; proportions: 'match' | 'differ' }
  | { applied: false; reason: 'no_dimensions' | 'empty_model' };

const extentsOf = (doc: Document): [number, number, number] | null => {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return null;
  const { min, max } = getBounds(scene);
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as [number, number, number];
  return size.every((v) => Number.isFinite(v) && v >= 0) && Math.max(...size) > 0 ? size : null;
};

/**
 * Scale uniformly so the longest side is the product's longest measured side (glTF is in
 * metres), then stand it on the floor, centred. Returns what was done, or why not.
 */
export async function fitToProduct(doc: Document, size: ProductSize | null): Promise<FitResult> {
  const known = [size?.widthMm, size?.heightMm, size?.depthMm].filter((v): v is number => typeof v === 'number' && v > 0);
  if (!known.length) return { applied: false, reason: 'no_dimensions' };
  const extents = extentsOf(doc);
  if (!extents) return { applied: false, reason: 'empty_model' };

  const scale = Math.max(...known) / 1000 / Math.max(...extents);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0]!;
  const fit = doc.createNode('tajribah-fit').setScale([scale, scale, scale]);
  for (const child of [...scene.listChildren()] as Node[]) { scene.removeChild(child); fit.addChild(child); }
  scene.addChild(fit);
  await doc.transform(center({ pivot: 'below' }));

  const sizeMm = extentsOf(doc)!.map((v) => Math.round(v * 1000 * 10) / 10) as [number, number, number];
  // Largest measurement against the largest side, and so on down: orientation-free, and no two
  // measurements can both claim the same side (a nearest-side match let a wrong height through).
  const sides = [...sizeMm].sort((x, y) => y - x);
  const agrees = [...known].sort((x, y) => y - x).every((mm, i) => Math.abs(sides[i]! - mm) / mm <= PROPORTION_TOLERANCE);
  return { applied: true, scale, sizeMm, proportions: agrees ? 'match' : 'differ' };
}

export function triangleCount(doc: Document): number {
  let count = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) continue; // triangles only
      count += Math.floor((primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3);
    }
  }
  return count;
}

/** Fewer triangles when over the budget; null when nothing needed doing. Expects a welded document. */
export async function simplifyTo(doc: Document, max = MAX_TRIANGLES): Promise<{ from: number; to: number } | null> {
  const from = triangleCount(doc);
  if (from <= max) return null;
  await MeshoptSimplifier.ready;
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: max / from, error: SIMPLIFY_ERROR }));
  return { from, to: triangleCount(doc) };
}

/** Every PNG/JPEG/WebP texture to WebP, fitted inside `maxPx`. KTX2 and others are left alone. */
export async function texturesToWebp(doc: Document, maxPx: number): Promise<void> {
  const common = { encoder: sharp, targetFormat: 'webp' as const, resize: [maxPx, maxPx] as [number, number], formats: /^image\/(png|jpeg|webp)$/ }; // matched against the MIME type
  await doc.transform(
    textureCompress({ ...common, slots: /^normalTexture$/, quality: NORMAL_WEBP_QUALITY }),
    textureCompress({ ...common, slots: /^(?!normalTexture$).*/, quality: WEBP_QUALITY }),
  );
}

/** Largest dimension of any texture we can read, for the report (a KTX2 we cannot decode counts 0). */
export function largestTexture(doc: Document): number {
  const side = (t: ReturnType<Document['createTexture']>) => {
    try { return Math.max(...(t.getSize() ?? [0, 0])); } catch { return 0; }
  };
  return Math.max(0, ...doc.getRoot().listTextures().map(side));
}

/** For the native file: opaque textures as JPEG (smaller), anything with transparency as PNG. */
export async function nativeTextureFormat(image: Uint8Array): Promise<'jpeg' | 'png'> {
  const stats = await sharp(image).stats();
  return stats.isOpaque ? 'jpeg' : 'png';
}
