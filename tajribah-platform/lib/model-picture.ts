/**
 * P3.8 — a 3D model's picture: the view the merchant chose in the 3D editor ("Use this view as the
 * picture"), taken by the viewer itself. Shared by the editor (what it captures) and the server
 * (what it accepts), so the two cannot disagree.
 */

/** The editor captures WebP; PNG and JPEG are accepted too (a browser without WebP encoding). */
export const PICTURE_TYPES = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' } as const;
export type PictureType = keyof typeof PICTURE_TYPES;

/** A capture of an 800 × 800 view is ~60–150 KB; 2 MB leaves room without letting a photo album in. */
export const PICTURE_MAX_BYTES = 2 * 1024 * 1024;
export const PICTURE_MIN_SIDE = 200;
export const PICTURE_MAX_SIDE = 2048;
/** A list thumbnail and a link preview: nothing longer than twice its height or width. */
export const PICTURE_MAX_ASPECT = 2;
