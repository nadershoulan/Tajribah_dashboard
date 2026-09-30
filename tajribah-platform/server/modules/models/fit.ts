/**
 * P3.5 — fitting a generated model to the product's real size (step 1 of post-processing). Kept apart
 * from the texture work (`postprocess.ts`, which needs `sharp`, a native module): the 3D editor uses
 * this on the dashboard's request path, which runs on Cloudflare Workers, where `sharp` cannot load.
 */
import type { Document, Node } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/core';
import { center } from '@gltf-transform/functions';

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
