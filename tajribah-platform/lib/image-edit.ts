/**
 * T128 — the picture editor's work, on plain pixels (RGBA), so it runs in the merchant's browser and in tests alike.
 *
 * An edit is a small record of choices (`Edits`); `applyEdits` turns a source picture into the result by running
 * `EDIT_STEPS` in order. Each step says when it applies and what it does — **a new tool is one more step** (plus its
 * field in `Edits`, its neutral value in `NO_EDITS`, and a control in the editor's tool list); nothing else changes.
 *
 * The order is deliberate: the merchant's erase clicks land on the picture as the store took it (so a later turn or
 * crop never moves them); the background comes off that same picture (its edges must still be the plain colour); then
 * the manual crop (on the picture as seen before turning it), the turn and the mirror, the
 * light and colour, the crop to the product, the clear margin, and last the size.
 *
 * Nothing here talks to the network or the page; the editor decodes the picture, calls `applyEdits`, and draws.
 */
import { NEAR, removeBackground, type Rgba } from './background';

export type { Rgba };

/** A point on the source picture, as shares of its width and height (0…1), so it means the same at any size. */
export type Spot = { x: number; y: number };

export type Edits = {
  /** Click-to-erase: each spot clears the area round it that shares its colour (a bust, a shadow, a second backdrop). */
  erase: Spot[];
  /** Take a plain (one-colour) background off — the store picture's white, usually. */
  removeBackground: boolean;
  /** How far from the background colour still counts as background (RGB distance; `NEAR` is the default). */
  tolerance: number;
  /** Percent cut from each side, 0…45 — before turning, as the picture is seen. */
  cropTop: number; cropRight: number; cropBottom: number; cropLeft: number;
  /** Degrees, clockwise; any angle. Quarter turns are exact (no resampling). */
  rotate: number;
  flipX: boolean;
  flipY: boolean;
  /** −100…100: darker…lighter. */
  brightness: number;
  /** −100…100: flatter…stronger. */
  contrast: number;
  /** −100…100: grey…vivid. */
  saturation: number;
  /** Cut away the clear margin round the product (the try-on reads the picture's width as the product's). */
  trim: boolean;
  /** A clear margin added round the result, percent of its larger side, 0…50. */
  padding: number;
  /** Percent of the size, 10…400. */
  scale: number;
};

export const NO_EDITS: Edits = {
  erase: [], removeBackground: false, tolerance: NEAR, cropTop: 0, cropRight: 0, cropBottom: 0, cropLeft: 0,
  rotate: 0, flipX: false, flipY: false, brightness: 0, contrast: 0, saturation: 0, trim: false, padding: 0, scale: 100,
};

export type EditFailure = 'not_plain' | 'nothing_left' | 'too_large';
export type EditResult = { ok: true; image: Rgba } | { ok: false; reason: EditFailure };

/** The longest side a result may have — far beyond the try-on's need, and a guard for the browser's memory. */
export const MAX_SIDE = 4096;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const blank = (width: number, height: number): Rgba => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
/** Degrees folded into 0…360. */
export const turnOf = (degrees: number) => ((degrees % 360) + 360) % 360;

/** Mirror left–right and/or top–bottom. */
export function flip(img: Rgba, x: boolean, y: boolean): Rgba {
  if (!x && !y) return img;
  const { width: w, height: h, data } = img;
  const out = blank(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const si = ((y ? h - 1 - j : j) * w + (x ? w - 1 - i : i)) * 4;
    out.data.set(data.subarray(si, si + 4), (j * w + i) * 4);
  }
  return out;
}

/** A quarter turn clockwise, exact. */
function quarter(img: Rgba): Rgba {
  const { width: w, height: h, data } = img;
  const out = blank(h, w);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const si = (j * w + i) * 4;
    out.data.set(data.subarray(si, si + 4), (i * h + (h - 1 - j)) * 4);
  }
  return out;
}

/** Bilinear sample with premultiplied alpha, so a clear neighbour never tints an edge. */
function sample(img: Rgba, x: number, y: number, into: Uint8ClampedArray, at: number): void {
  const { width: w, height: h, data } = img;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  let r = 0, g = 0, b = 0, a = 0;
  const taps: [number, number, number][] = [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]];
  for (const [dx, dy, wt] of taps) {
    const px = x0 + dx, py = y0 + dy;
    if (wt === 0 || px < 0 || py < 0 || px >= w || py >= h) continue;
    const i = (py * w + px) * 4, al = data[i + 3]! * wt;
    r += data[i]! * al; g += data[i + 1]! * al; b += data[i + 2]! * al; a += al;
  }
  if (a > 0) { into[at] = r / a; into[at + 1] = g / a; into[at + 2] = b / a; }
  into[at + 3] = a;
}

/** Turn by any angle (degrees, clockwise). Whole quarter turns are exact; the rest grows the picture to hold the corners, which are clear. */
export function rotate(img: Rgba, degrees: number): Rgba {
  let d = turnOf(degrees);
  let out = img;
  const quarters = Math.floor(d / 90 + 1e-9);
  for (let k = 0; k < quarters; k++) out = quarter(out);
  d -= quarters * 90;
  if (d < 1e-6 || d > 90 - 1e-6) return d > 90 - 1e-6 ? quarter(out) : out;
  const rad = (d * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const { width: w, height: h } = out;
  const W = Math.ceil(w * cos + h * sin - 1e-9), H = Math.ceil(w * sin + h * cos - 1e-9);
  const res = blank(W, H);
  const cx = w / 2, cy = h / 2, CX = W / 2, CY = H / 2;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    // the destination pixel's centre, turned back into the source
    const dx = i + 0.5 - CX, dy = j + 0.5 - CY;
    sample(out, cos * dx + sin * dy + cx - 0.5, -sin * dx + cos * dy + cy - 0.5, res.data, (j * W + i) * 4);
  }
  return res;
}

/** Resize by a factor (bilinear; halving steps first when shrinking a lot, so detail is averaged, not skipped). */
export function resize(img: Rgba, factor: number): Rgba {
  let out = img;
  let k = factor;
  while (k < 0.5) { out = resizeOnce(out, 0.5); k /= 0.5; }
  return Math.abs(k - 1) < 1e-9 ? out : resizeOnce(out, k);
}

function resizeOnce(img: Rgba, k: number): Rgba {
  const W = Math.max(1, Math.round(img.width * k)), H = Math.max(1, Math.round(img.height * k));
  const res = blank(W, H);
  const sx = img.width / W, sy = img.height / H;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) sample(img, (i + 0.5) * sx - 0.5, (j + 0.5) * sy - 0.5, res.data, (j * W + i) * 4);
  return res;
}

/** Brightness, contrast and saturation, each −100…100; clear pixels stay clear. */
export function adjust(img: Rgba, brightness: number, contrast: number, saturation = 0): Rgba {
  if (!brightness && !contrast && !saturation) return img;
  const b = clamp(brightness, -100, 100) * 2.55;
  const c = clamp(contrast, -100, 100) / 100;
  const cf = c >= 0 ? 1 + c * 2 : 1 + c; // up to 3× stronger, down to flat
  const sf = 1 + clamp(saturation, -100, 100) / 100; // 0 = grey, 2 = twice as vivid
  const out = blank(img.width, img.height);
  const s = img.data, d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    let r = (s[i]! - 128) * cf + 128 + b, g = (s[i + 1]! - 128) * cf + 128 + b, bl = (s[i + 2]! - 128) * cf + 128 + b;
    const grey = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = grey + (r - grey) * sf; g = grey + (g - grey) * sf; bl = grey + (bl - grey) * sf;
    d[i] = r; d[i + 1] = g; d[i + 2] = bl; d[i + 3] = s[i + 3]!;
  }
  return out;
}

/** Cut a share (percent, 0…45) from each side. Null when nothing is left. */
export function crop(img: Rgba, top: number, right: number, bottom: number, left: number): Rgba | null {
  const { width: w, height: h, data } = img;
  const x0 = Math.round((w * clamp(left, 0, 45)) / 100), x1 = w - Math.round((w * clamp(right, 0, 45)) / 100);
  const y0 = Math.round((h * clamp(top, 0, 45)) / 100), y1 = h - Math.round((h * clamp(bottom, 0, 45)) / 100);
  const cw = x1 - x0, ch = y1 - y0;
  if (cw < 1 || ch < 1) return null;
  if (cw === w && ch === h) return img;
  const out = blank(cw, ch);
  for (let j = 0; j < ch; j++) out.data.set(data.subarray(((j + y0) * w + x0) * 4, ((j + y0) * w + x1) * 4), j * cw * 4);
  return out;
}

/** Cut away the clear margin (alpha at or under `threshold`). Null when nothing is left. */
export function trim(img: Rgba, threshold = 8): Rgba | null {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (data[(j * w + i) * 4 + 3]! > threshold) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  if (cw === w && ch === h) return img;
  const out = blank(cw, ch);
  for (let j = 0; j < ch; j++) out.data.set(data.subarray(((j + y0) * w + x0) * 4, ((j + y0) * w + x1 + 1) * 4), j * cw * 4);
  return out;
}

/** A clear margin round the picture: `percent` of its larger side on every edge. */
export function pad(img: Rgba, percent: number): Rgba {
  const m = Math.round((Math.max(img.width, img.height) * clamp(percent, 0, 50)) / 100);
  if (m === 0) return img;
  const W = img.width + 2 * m, H = img.height + 2 * m;
  const out = blank(W, H);
  for (let j = 0; j < img.height; j++) out.data.set(img.data.subarray(j * img.width * 4, (j + 1) * img.width * 4), ((j + m) * W + m) * 4);
  return out;
}

/** The most erase clicks kept — far beyond a real picture's need. */
export const MAX_SPOTS = 60;

/**
 * Clear what is connected to each spot and within `tolerance` of its colour (RGB distance); the pixels just beyond
 * fade over a second `tolerance`, so the cut edge is soft, not jagged. Already-clear pixels are left as they are.
 */
export function eraseAt(img: Rgba, spots: Spot[], tolerance: number): Rgba {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const tol = clamp(tolerance, 1, 200);
  const out = new Uint8ClampedArray(data);
  const cleared = new Uint8Array(n);
  const queue = new Int32Array(n);
  let any = false;
  for (const spot of spots.slice(0, MAX_SPOTS)) {
    const sx = Math.min(w - 1, Math.max(0, Math.floor(clamp(spot.x, 0, 1) * w)));
    const sy = Math.min(h - 1, Math.max(0, Math.floor(clamp(spot.y, 0, 1) * h)));
    const seed = sy * w + sx;
    if (cleared[seed] || data[seed * 4 + 3] === 0) continue;
    const c: [number, number, number] = [data[seed * 4]!, data[seed * 4 + 1]!, data[seed * 4 + 2]!];
    const near = (i: number) => data[i * 4 + 3]! > 0 && Math.hypot(data[i * 4]! - c[0], data[i * 4 + 1]! - c[1], data[i * 4 + 2]! - c[2]) <= tol;
    const mark = new Uint8Array(n);
    let head = 0, tail = 0;
    mark[seed] = 1; queue[tail++] = seed;
    while (head < tail) {
      const i = queue[head++]!;
      cleared[i] = 1; out[i * 4 + 3] = 0; any = true;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < n && !mark[j] && near(j)) { mark[j] = 1; queue[tail++] = j; }
      }
    }
    // the soft edge: a neighbour of the cleared area fades with how close its colour is to the clicked one
    for (let k = 0; k < tail; k++) {
      const i = queue[k]!, x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || cleared[j]) continue;
        const d = Math.hypot(data[j * 4]! - c[0], data[j * 4 + 1]! - c[1], data[j * 4 + 2]! - c[2]);
        if (d < tol * 2) out[j * 4 + 3] = Math.min(out[j * 4 + 3]!, Math.round(data[j * 4 + 3]! * ((d - tol) / tol)));
      }
    }
  }
  return any ? { data: out, width: w, height: h } : img;
}

/**
 * The steps, in order. To add a tool: give `Edits` its field (and `NO_EDITS` its neutral value), add a step here,
 * and a control in the editor's tool list (`components/dashboard/image-editor.tsx`).
 */
export type EditStep = { id: string; applies: (e: Edits) => boolean; run: (img: Rgba, e: Edits) => Rgba | EditResult };

const failed = (reason: EditFailure): EditResult => ({ ok: false, reason });

export const EDIT_STEPS: EditStep[] = [
  { id: 'erase', applies: (e) => e.erase.length > 0, run: (img, e) => eraseAt(img, e.erase, e.tolerance) },
  { id: 'background', applies: (e) => e.removeBackground, run: (img, e) => removeBackground(img, { near: clamp(e.tolerance, 5, 120) }) },
  { id: 'crop', applies: (e) => e.cropTop + e.cropRight + e.cropBottom + e.cropLeft > 0, run: (img, e) => crop(img, e.cropTop, e.cropRight, e.cropBottom, e.cropLeft) ?? failed('nothing_left') },
  { id: 'rotate', applies: (e) => turnOf(e.rotate) !== 0, run: (img, e) => rotate(img, e.rotate) },
  { id: 'flip', applies: (e) => e.flipX || e.flipY, run: (img, e) => flip(img, e.flipX, e.flipY) },
  { id: 'adjust', applies: (e) => e.brightness !== 0 || e.contrast !== 0 || e.saturation !== 0, run: (img, e) => adjust(img, e.brightness, e.contrast, e.saturation) },
  { id: 'trim', applies: (e) => e.trim, run: (img) => trim(img) ?? failed('nothing_left') },
  { id: 'padding', applies: (e) => e.padding > 0, run: (img, e) => pad(img, e.padding) },
  { id: 'scale', applies: (e) => e.scale !== 100, run: (img, e) => resize(img, clamp(e.scale, 10, 400) / 100) },
];

/** The source with every chosen edit applied, in `EDIT_STEPS` order. */
export function applyEdits(source: Rgba, edits: Edits, steps: EditStep[] = EDIT_STEPS): EditResult {
  let img = source;
  for (const step of steps) {
    if (!step.applies(edits)) continue;
    const next = step.run(img, edits);
    if ('ok' in next) { if (!next.ok) return next; img = next.image; } else img = next;
    if (img.width > MAX_SIDE || img.height > MAX_SIDE) return failed('too_large');
  }
  return { ok: true, image: img };
}

/** Whether any edit is chosen (the editor's "nothing to save yet"); a list counts by what is in it. */
export const isEdited = (e: Edits) => (Object.keys(NO_EDITS) as (keyof Edits)[]).some((k) => {
  const v = e[k], none = NO_EDITS[k];
  return Array.isArray(v) && Array.isArray(none) ? v.length !== none.length : v !== none;
});

export const EDIT_REASONS: Record<EditFailure, { ar: string; en: string }> = {
  not_plain: { ar: 'خلفية هذه الصورة ليست لونًا واحدًا، فلا تُزال تلقائيًا. ارفع «حساسية الخلفية» قليلًا، أو أبقِ الخلفية وأزل ما لا تريده بـ«امسح بالنقر».', en: 'This picture’s background is not one plain colour, so it cannot be taken off automatically. Raise “Background tolerance” a little, or keep the background and take off what you do not want with “Erase by clicking”.' },
  nothing_left: { ar: 'لم يبقَ شيء من الصورة بعد هذا التعديل.', en: 'Nothing of the picture is left after this edit.' },
  too_large: { ar: 'الصورة أكبر من اللازم بعد التكبير — صغّر المقياس.', en: 'The picture is too large after scaling — lower the scale.' },
};
