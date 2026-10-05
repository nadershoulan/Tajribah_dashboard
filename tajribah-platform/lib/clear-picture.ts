/**
 * T88/T92 — a store picture made into a try-on cut-out, in the merchant's browser: fetched through the
 * dashboard (API-191: only the product's own pictures, fetched safely), its plain background taken off
 * (`lib/background.ts`), cropped to the product, and handed back as a PNG to upload like any cut-out.
 * One copy for the product's preview and its try-on settings.
 */
import { BACKGROUND_REASONS, removeBackground } from './background';
import type { Bi } from './lang';

/** The longest side the picture is worked on at: plenty for the try-on, quick in the browser. */
export const WORK_PX = 1600;

export type ClearedPicture = { ok: true; file: File } | { ok: false; reason: Bi };

export async function clearStorePicture(photo: Blob): Promise<ClearedPicture> {
  const bitmap = await createImageBitmap(photo);
  const k = Math.min(1, WORK_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k); canvas.height = Math.round(bitmap.height * k);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const cleared = removeBackground({ data: g.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height });
  if (!cleared.ok) return { ok: false, reason: BACKGROUND_REASONS[cleared.reason] };
  const out = document.createElement('canvas');
  out.width = cleared.image.width; out.height = cleared.image.height;
  out.getContext('2d')!.putImageData(new ImageData(cleared.image.data as Uint8ClampedArray<ArrayBuffer>, cleared.image.width, cleared.image.height), 0, 0);
  const png = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be made'))), 'image/png'));
  return { ok: true, file: new File([png], 'cutout.png', { type: 'image/png' }) };
}
