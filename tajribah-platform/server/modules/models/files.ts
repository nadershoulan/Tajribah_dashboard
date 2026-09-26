/**
 * Which stored file of a model version is which. One version has up to four rows in
 * `model_files` (db/schema/ar.ts), told apart by format, variant and compression:
 *
 *  - `original`  — the upload, as it came.
 *  - `web`       — GLB, meshopt (+ KTX2 textures, P1.13b): for `<model-viewer>` in the page.
 *  - `native`    — GLB, no compression, PNG/JPEG ≤ 2048 px: for Android's Scene Viewer, which
 *                  reads neither meshopt nor KTX2; also what the USDZ is converted from.
 *  - `quickLook` — USDZ for iPhone: converted from `native`, or the upload itself when the
 *                  merchant uploaded a USDZ.
 *
 * Every lookup goes through `fileFor`, so "the optimised file" can never mean two things.
 */
import type { ModelFile } from '@/db/schema';

export type FileRole = 'original' | 'web' | 'native' | 'quickLook';
type Made = Exclude<FileRole, 'original'>;

/** What the pipeline writes for each role, and the file name under `v{n}/`. */
export const MADE_FILES: Record<Made, { format: 'glb' | 'usdz'; compression: 'meshopt' | 'none'; filename: string }> = {
  web: { format: 'glb', compression: 'meshopt', filename: 'optimized.glb' },
  native: { format: 'glb', compression: 'none', filename: 'native.glb' },
  quickLook: { format: 'usdz', compression: 'none', filename: 'model.usdz' },
};

type FileShape = Pick<ModelFile, 'format' | 'variant' | 'compression'>;

export function fileFor<T extends FileShape>(files: readonly T[], role: FileRole): T | undefined {
  if (role === 'original') return files.find((f) => f.variant === 'original');
  const want = MADE_FILES[role];
  const made = files.find((f) => f.variant === 'optimized' && f.format === want.format && f.compression === want.compression);
  if (made || role !== 'quickLook') return made;
  return files.find((f) => f.variant === 'original' && f.format === 'usdz');
}
