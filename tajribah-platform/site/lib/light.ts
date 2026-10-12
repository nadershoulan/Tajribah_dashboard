/**
 * T140.2 — the product lit like the shopper's photo (Nader: "make a gold watch slightly warmer or darker in a dim indoor
 * photo"). The product pictures are lit in a studio; a shopper's photo often is not — a dim room, a warm lamp. Drawn as
 * it is, the product glows on a dark photo and looks pasted on (the shadow, T134.1, was the first step; this is the
 * second).
 *
 * **What is measured** (the whole photo, small): how bright its light is — its brightest 2 %, not its average, so a
 * dark sleeve or darker skin never reads as "dim light" — and the light's colour, from its highlights (the brightest
 * pixels that are not blown out): a lamp's yellow shows there. **What is done**: the product is only ever made darker
 * (never brighter — a bright photo leaves it as it is), and its colour moved part of the way towards the light's, at
 * most a tenth either way. Gentle on purpose: a little matching reads as real, too much as a filter.
 *
 * Pure maths here is tested; the picture is made once per product and light (cached), at the product picture's own
 * resolution, with plain pixel work (every phone browser).
 */

export type Light = { level: number; cast: [number, number, number] };
export type Tint = { brightness: number; r: number; g: number; b: number };
export const NEUTRAL: Tint = { brightness: 1, r: 1, g: 1, b: 1 };

/** The brightest pixels' level at or above which the light counts as full (nothing is darkened). */
export const FULL_LIGHT = 0.8;
/** The darkest the product is ever made (a share of its own brightness). */
export const DARKEST = 0.66;
/** How far the product's colour moves towards the light's, and the most it moves either way. */
export const CAST_SHARE = 0.5;
export const CAST_MAX = 0.1;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The light of a photo from its pixels (RGBA, 0…255, as a canvas gives them). */
export function lightOf(rgba: ArrayLike<number>): Light {
  const n = Math.floor(rgba.length / 4);
  if (!n) return { level: 1, cast: [1, 1, 1] };
  const lum = new Float32Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const v = (rgba[i * 4]! * 299 + rgba[i * 4 + 1]! * 587 + rgba[i * 4 + 2]! * 114) / 1000;
    lum[i] = v; hist[Math.min(255, Math.round(v))]!++;
  }
  const at = (part: number) => { let seen = 0; for (let v = 0; v < 256; v++) { seen += hist[v]!; if (seen >= part * n) return v; } return 255; };
  const level = at(0.98) / 255;
  // the light's colour: among the pixels not blown out, the brightest tenth — and only those at least three quarters as
  // bright as the brightest of them (a mostly dark photo's dark pixels are not highlights)
  const open = new Uint32Array(256);
  let shown = 0, top = 0;
  for (let i = 0; i < n; i++) if (Math.max(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!) < 250) { const v = Math.min(255, Math.round(lum[i]!)); open[v]!++; shown++; top = Math.max(top, v); }
  let from = 0;
  for (let v = 0, seen = 0; v < 256; v++) { seen += open[v]!; if (seen >= 0.9 * shown) { from = v; break; } }
  from = Math.max(from, 0.75 * top);
  let r = 0, g = 0, b = 0, k = 0;
  for (let i = 0; i < n; i++) {
    const R = rgba[i * 4]!, G = rgba[i * 4 + 1]!, B = rgba[i * 4 + 2]!;
    if (Math.max(R, G, B) < 250 && Math.round(lum[i]!) >= from) { r += R; g += G; b += B; k++; }
  }
  if (!k || r + g + b === 0) return { level, cast: [1, 1, 1] };
  const mean = (r + g + b) / 3;
  return { level, cast: [r / mean, g / mean, b / mean] };
}

/** How to light the product for that photo: darker in dim light (never brighter), its colour a little towards the light's. */
export function tintOf(light: Light): Tint {
  const brightness = light.level >= FULL_LIGHT ? 1 : clamp(DARKEST + ((1 - DARKEST) * light.level) / FULL_LIGHT, DARKEST, 1);
  const towards = (c: number) => clamp(1 + CAST_SHARE * (c - 1), 1 - CAST_MAX, 1 + CAST_MAX);
  return { brightness, r: towards(light.cast[0]), g: towards(light.cast[1]), b: towards(light.cast[2]) };
}

/** Near enough to no change that nothing is redrawn. */
export const isNeutral = (t: Tint) => Math.abs(t.brightness - 1) < 0.02 && Math.abs(t.r - 1) < 0.02 && Math.abs(t.g - 1) < 0.02 && Math.abs(t.b - 1) < 0.02;
const keyOf = (t: Tint) => [t.brightness, t.r, t.g, t.b].map((v) => v.toFixed(2)).join(',');

// ── The browser's pictures ────────────────────────────────────────────────────────────────────────────────────────
type Canvasish = HTMLCanvasElement | OffscreenCanvas;
const make = (w: number, h: number): Canvasish => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
const sizeOf = (img: CanvasImageSource) => { const s = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }; return { w: s.naturalWidth || Number(s.width) || 0, h: s.naturalHeight || Number(s.height) || 0 }; };

/** A photo's light, measured on a small copy of it (enough for its brightest pixels and their colour). */
export function measureLight(photo: CanvasImageSource): Light {
  const c = make(96, 96), g = c.getContext('2d') as CanvasRenderingContext2D | null;
  if (!g) return { level: 1, cast: [1, 1, 1] };
  g.drawImage(photo, 0, 0, 96, 96);
  return lightOf(g.getImageData(0, 0, 96, 96).data);
}

const litCache = new WeakMap<object, Map<string, Canvasish>>();
/** The product picture lit with `tint` (its own resolution, at most 2048 px a side) — the same object for the same light. */
export function litProduct(image: CanvasImageSource, tint: Tint): CanvasImageSource {
  if (isNeutral(tint)) return image;
  const { w: nw, h: nh } = sizeOf(image);
  if (!nw || !nh) return image;
  const key = keyOf(tint);
  let byTint = litCache.get(image as object);
  const kept = byTint?.get(key);
  if (kept) return kept as CanvasImageSource;
  const k = Math.min(1, 2048 / Math.max(nw, nh)), w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
  const c = make(w, h), g = c.getContext('2d') as CanvasRenderingContext2D | null;
  if (!g) return image;
  g.drawImage(image, 0, 0, w, h);
  let data: ImageData;
  try { data = g.getImageData(0, 0, w, h); } catch { return image; } // a picture the canvas may not read: as it is
  const d = data.data, mr = tint.brightness * tint.r, mg = tint.brightness * tint.g, mb = tint.brightness * tint.b;
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i]! * mr; d[i + 1] = d[i + 1]! * mg; d[i + 2] = d[i + 2]! * mb; }
  g.putImageData(data, 0, 0);
  if (!byTint) { byTint = new Map(); litCache.set(image as object, byTint); }
  byTint.set(key, c);
  return c as CanvasImageSource;
}

const urlCache = new WeakMap<object, Map<string, string>>();
/** The lit product as an address for an `<img>` (the phone's result view), or the original address when unchanged. */
export function litUrl(image: HTMLImageElement, tint: Tint): string {
  if (isNeutral(tint)) return image.src;
  const key = keyOf(tint);
  let byTint = urlCache.get(image);
  const kept = byTint?.get(key);
  if (kept) return kept;
  const lit = litProduct(image, tint);
  if (lit === image) return image.src;
  let url = image.src;
  try {
    const c = lit as HTMLCanvasElement | OffscreenCanvas;
    if ('toDataURL' in c) url = c.toDataURL('image/png');
    else { const flat = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height }); flat.getContext('2d')!.drawImage(c as CanvasImageSource, 0, 0); url = flat.toDataURL('image/png'); }
  } catch { return image.src; }
  if (!byTint) { byTint = new Map(); urlCache.set(image, byTint); }
  byTint.set(key, url);
  return url;
}
