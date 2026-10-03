/**
 * P5.9 — is a watch's cut-out drawn at its real size in the owner's studio?
 *
 * The studio draws a cut-out's **full width as the case width** (compare mode: `caseMm × 4.3 px`,
 * with the ruler spanning the whole picture; model mode: the pose tuned to the demo's framing).
 * The studio's own pictures are cropped tight — the case, their widest part, touches both sides.
 * So empty space at a picture's sides makes the watch look smaller than it is.
 *
 * Two facts decide it, read from the picture's alpha channel alone (this file is shared by the
 * server, which decodes with sharp, and the preview, which decodes with a canvas):
 *  - `box`: where anything visible is (alpha ≥ TRIM_ALPHA). Outside it the picture is empty and
 *    can be cropped away with nothing seen lost.
 *  - `solidWidest`: the widest run of the watch's visible body (alpha ≥ SOLID_ALPHA) in any row.
 *    After cropping, `solidWidest / box width` is the share of its real size the watch is shown
 *    at: a soft shadow or glow at the sides widens the picture but not the watch.
 *
 * Measured on the studio's own pictures: flat 95 / 95 px, worn 223 / 224 px — 100% and 99.6%.
 */

/** Below ~3% opacity a pixel cannot be seen over any photo: cropping it away loses nothing. */
export const TRIM_ALPHA = 8;
/** Half-opaque and up is the watch's visible edge. */
export const SOLID_ALPHA = 128;
/** At or above this share the watch is true to size: 3% is about 1 mm on a 30 mm case. */
export const TRUE_SIZE_MIN = 0.97;

export type AlphaBox = { left: number; top: number; width: number; height: number };
export type AlphaFacts = { width: number; height: number; box: AlphaBox | null; solidWidest: number };

/** The facts of an RGBA picture (4 bytes a pixel, row by row). */
export function alphaFacts(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): AlphaFacts {
  let left = width, right = -1, top = height, bottom = -1, solidWidest = 0;
  for (let y = 0; y < height; y++) {
    let first = -1, last = -1, solidFirst = -1, solidLast = -1;
    for (let x = 0, i = y * width * 4 + 3; x < width; x++, i += 4) {
      const a = rgba[i]!;
      if (a >= TRIM_ALPHA) { if (first < 0) first = x; last = x; }
      if (a >= SOLID_ALPHA) { if (solidFirst < 0) solidFirst = x; solidLast = x; }
    }
    if (first >= 0) {
      if (first < left) left = first;
      if (last > right) right = last;
      if (y < top) top = y;
      bottom = y;
    }
    if (solidFirst >= 0) solidWidest = Math.max(solidWidest, solidLast - solidFirst + 1);
  }
  const box = right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
  return { width, height, box, solidWidest };
}

/** Does cropping to the box remove anything? */
export function hasMargins(f: AlphaFacts): boolean {
  return !!f.box && (f.box.width < f.width || f.box.height < f.height);
}

/** The share of its real size the watch is shown at, once cropped to its box (0 when empty). */
export function sizeShown(f: AlphaFacts): number {
  if (!f.box) return 0;
  return Math.round((f.solidWidest / f.box.width) * 1000) / 1000;
}

/** What one picture's check found, kept against the key it was made for. */
export type SlotQuality = {
  key: string;
  /** 0–1: the share of its real size the watch is shown at. */
  sizeShown: number;
  /** Empty edges were cropped away (the stored picture is the cropped one). */
  trimmed: boolean;
  /** P5.12: a PNG stored as lossless WebP — the same pixels, fewer bytes. */
  converted?: boolean;
  issue?: 'empty' | 'unreadable';
};
export type TryOnQuality = { worn?: SlotQuality; flat?: SlotQuality };

/** The watch's score, 0–100: the worse picture's share of real size. Null until both are checked. */
export function qualityScore(worn: SlotQuality | null | undefined, flat: SlotQuality | null | undefined): number | null {
  if (!worn || !flat) return null;
  return Math.floor(Math.min(worn.sizeShown, flat.sizeShown) * 100);
}

/**
 * T68 calibration — the merchant marks the case's left and right edges on a picture (the try-on
 * settings screen); the picture is cropped to exactly that span, full height, so its full width is
 * the case. The narrowest span accepted, in the picture's own pixels.
 */
export const CALIBRATE_MIN_PX = 20;

/** The crop for marks at `left`..`right` (pixel columns, right exclusive), or null when they cannot be one. */
export function calibrationCrop(width: number, height: number, left: number, right: number): AlphaBox | null {
  if (![width, height, left, right].every(Number.isInteger)) return null;
  if (left < 0 || right > width || right - left < CALIBRATE_MIN_PX) return null;
  if (left === 0 && right === width) return null; // nothing to cut
  return { left, top: 0, width: right - left, height };
}
