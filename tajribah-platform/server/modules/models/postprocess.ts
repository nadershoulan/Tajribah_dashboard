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
import type { Document } from '@gltf-transform/core';
import { simplify, textureCompress } from '@gltf-transform/functions';
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
export { PROPORTION_TOLERANCE, fitToProduct, type FitResult, type ProductSize } from './fit';

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
