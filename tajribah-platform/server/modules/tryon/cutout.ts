/**
 * P5.10 — is this file a watch cut-out the owner's studio can draw?
 *
 * The studio lays the watch over a photo of a wrist, so the picture must be **transparent around
 * the watch**: a PNG or WebP with an alpha channel. A JPEG, or a PNG/WebP saved without alpha,
 * would draw a white box on the wrist. That is read from the file's own header — PNG's colour
 * type (or its `tRNS` chunk), WebP's VP8X alpha flag or VP8L's alpha hint — not from the name
 * or the browser's word. Whether every edge pixel is truly clear needs the pixels; the preview in
 * the screen shows the merchant exactly what the studio will draw.
 */
import type { CutoutIssueCode } from '@/lib/tryon';
import { dimensions, sniff, type PhotoFormat } from '@/server/modules/ai-jobs/photo-check';

export const CUTOUT_MAX_BYTES = 10 * 1024 * 1024;
/**
 * The long side must be at least this. Set from the studio's own real assets: the demo's flat shot
 * is 95 × 213 px and draws well, so 200 px refuses thumbnails without refusing what works.
 */
export const CUTOUT_MIN_SIDE = 200;

export type CutoutIssue = CutoutIssueCode;
export type CutoutVerdict = { ok: true; format: 'png' | 'webp'; width: number; height: number } | { ok: false; issue: CutoutIssue };

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u32be = (b: Uint8Array, at: number) => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;

/** Does the image carry transparency, by its own header? */
export function hasAlpha(bytes: Uint8Array, format: PhotoFormat): boolean {
  if (format === 'png') {
    const colourType = bytes[25];
    if (colourType === 4 || colourType === 6) return true; // grey + alpha, RGB + alpha
    // Palette or plain colour with a tRNS chunk before the image data.
    let at = 8;
    while (at + 8 <= bytes.length) {
      const length = u32be(bytes, at);
      const type = ascii(bytes, at + 4, 4);
      if (type === 'tRNS') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      at += 12 + length;
    }
    return false;
  }
  if (format === 'webp') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') return bytes.length > 20 && (bytes[20]! & 0x10) !== 0;
    if (chunk === 'VP8L') return bytes.length > 24 && (bytes[24]! & 0x10) !== 0; // alpha_is_used
    return false; // simple lossy WebP has no alpha
  }
  return false;
}

export function checkCutout(bytes: Uint8Array, sizeBytes: number): CutoutVerdict {
  if (sizeBytes > CUTOUT_MAX_BYTES) return { ok: false, issue: 'too_large_file' };
  const format = sniff(bytes);
  if (format !== 'png' && format !== 'webp') return { ok: false, issue: 'not_png_or_webp' };
  const size = dimensions(bytes, format);
  if (!size) return { ok: false, issue: 'unreadable' };
  if (!hasAlpha(bytes, format)) return { ok: false, issue: 'no_transparency' };
  if (Math.max(size.width, size.height) < CUTOUT_MIN_SIDE) return { ok: false, issue: 'too_small' };
  return { ok: true, format, ...size };
}
