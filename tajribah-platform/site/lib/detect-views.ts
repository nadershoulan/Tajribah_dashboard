/**
 * T138 — the harder looks at a still photo, shared by the hand and the face detectors (`hand-detect.ts`,
 * `face-detect.ts`). MediaPipe's models want the hand or face upright, clear and a fair size in the picture; a
 * shopper's photo is often none of those. Measured on real photos made harder the way a phone photo goes wrong (the
 * T138 bench), each look below finds what the plain look missed:
 *
 * 0. **cleaned, first — only for a dark or grainy photo** (an evening photo indoors): made smaller with smoothing, which
 *    averages the grain away, and its light stretched between its darkest and brightest (lifted further when dark).
 *    On such a photo the plain look missed the hand, or "found" one with its points scattered by the grain; a clean
 *    photo never gets this look (its light and grain are measured first);
 * 1. **as it is**;
 * 2. **turned** a quarter, three quarters (and, for a hand, a half — a face is never upside down in a selfie, and the
 *    face model fits an upside-down face wrongly: chin where the forehead is);
 * 3. **shrunk** into a margin of its own edge colour — a hand or face so close it fills the photo is not found until
 *    it has room round it (a little grain averages away there too);
 * 4. **zoomed** — five overlapping crops (the middle first), for a hand or face small and far away.
 *
 * Each look's points are brought back to the photo as it is shown (`back`). Pure maths here is tested; the pictures
 * are made with plain canvas drawing and pixel work (every phone browser — a canvas `filter` is not everywhere).
 */
import { unrotate, type Pt } from './placement';

export type How = 'cleaned' | 'as-is' | 'turned' | 'shrunk' | 'zoomed';
export type Picture = HTMLImageElement | HTMLCanvasElement;
export type View = { picture: Picture; back: (p: Pt) => Pt; how: How; quarters: number };
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * A photo's light: its mean brightness (0…1) and its grain — the typical difference between neighbouring pixels'
 * brightness (0…255) in its middle, at full size: a clean photo's is a few, a grainy one's tens.
 */
export type Light = { brightness: number; grain: number };
export const GRAINY = 9;
export const DARK = 0.25;
/** Dark or grainy: looked at cleaned first. */
export const needsCleaning = (l: Light) => l.grain >= GRAINY || l.brightness < DARK;
/**
 * The cleaned looks' longer sides, in pixels — the second smaller, for heavier grain (measured: 512 suits a dark photo,
 * 320 a very grainy one; a dark or grainy photo gets both, in turn).
 */
export const CLEAN_SIDES = [512, 320];

/**
 * How to stretch a photo's light (brightness 0…255 per pixel): from its darkest 1 % to its brightest 1 %, and a lift
 * (gamma below 1) when what is left is still dark.
 */
export function levelsOf(brightness: ArrayLike<number>): { lo: number; hi: number; gamma: number } {
  const n = brightness.length;
  if (!n) return { lo: 0, hi: 1, gamma: 1 };
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, Math.round(brightness[i]!))); hist[v]!++; sum += v; }
  const at = (part: number) => { let seen = 0; for (let v = 0; v < 256; v++) { seen += hist[v]!; if (seen >= part * n) return v; } return 255; };
  const lo = at(0.01) / 255, hi = Math.max(lo + 0.1, at(0.99) / 255);
  const mid = Math.max(0, Math.min(1, (sum / n / 255 - lo) / (hi - lo)));
  return { lo, hi, gamma: mid < 0.25 ? 0.55 : mid < 0.4 ? 0.75 : 1 };
}

/** The typical (median) difference between neighbours in a row of brightness values — the photo's grain. */
export function grainOf(brightness: ArrayLike<number>, width: number): number {
  const diffs: number[] = [];
  for (let i = 0; i + 1 < brightness.length; i++) if ((i + 1) % width !== 0) diffs.push(Math.abs(brightness[i + 1]! - brightness[i]!));
  if (!diffs.length) return 0;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)]!;
}

/** The photo's share of the shrunk look's side (the rest is margin). */
export const SHRINK = 0.6;
/** The zoomed looks: the middle, then the four corners — each 60 % of the photo, overlapping. */
export const CROPS: Rect[] = [
  { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
  { x: 0, y: 0, w: 0.6, h: 0.6 }, { x: 0.4, y: 0, w: 0.6, h: 0.6 },
  { x: 0, y: 0.4, w: 0.6, h: 0.6 }, { x: 0.4, y: 0.4, w: 0.6, h: 0.6 },
];

/**
 * A hand or face found small (its points spanning less than this share of the photo's shorter side) is looked at once
 * more, closer: a square crop round it, `CLOSER` times its size — its points come out more exact.
 */
export const SMALL = 0.2;
export const CLOSER = 2.4;

/** The square crop round points found small (0…1 on a w × h photo), or null when they are not small. */
export function closerCrop(points: Pt[], w: number, h: number): Rect | null {
  if (!points.length || !(w > 0 && h > 0)) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x * w); y0 = Math.min(y0, p.y * h); x1 = Math.max(x1, p.x * w); y1 = Math.max(y1, p.y * h); }
  const span = Math.max(x1 - x0, y1 - y0);
  if (span >= SMALL * Math.min(w, h)) return null;
  const side = Math.min(Math.max(span * CLOSER, 32), w, h);
  const cx = Math.min(Math.max((x0 + x1) / 2, side / 2), w - side / 2), cy = Math.min(Math.max((y0 + y1) / 2, side / 2), h - side / 2);
  return { x: (cx - side / 2) / w, y: (cy - side / 2) / h, w: side / w, h: side / h };
}

/**
 * Points found small looked at once more on a crop round them (`look` returns what the detector finds on a picture);
 * the closer answer replaces the first only when the detector finds it there.
 */
export function closerLook<P extends Pt>(look: (picture: Picture) => P[][] | null, img: Picture, found: P[][], make: Makers = browser): { found: P[][]; closer: boolean } {
  const { w, h } = sizeOf(img);
  const crop = closerCrop(found[0] ?? [], w, h);
  if (!crop) return { found, closer: false };
  const near = look(make.cropped(img, crop));
  if (!near?.length) return { found, closer: false };
  return { found: near.map((one) => one.map((p) => ({ ...p, ...fromCrop(p, crop) }))), closer: true };
}

/** A point found on the shrunk look, back on the photo (both 0…1). */
export const fromShrunk = (p: Pt, s = SHRINK): Pt => ({ x: (p.x - (1 - s) / 2) / s, y: (p.y - (1 - s) / 2) / s });
/** A point found on a crop, back on the photo (both 0…1). */
export const fromCrop = (p: Pt, c: Rect): Pt => ({ x: c.x + p.x * c.w, y: c.y + p.y * c.h });

/** The pictures each look needs; the browser's by default, stand-ins in tests. */
export type Makers = {
  light(img: Picture): Light;
  cleaned(img: Picture, side: number): Picture;
  turned(img: Picture, quarters: number): Picture;
  shrunk(img: Picture): Picture;
  cropped(img: Picture, c: Rect): Picture;
};

/** Every look in order, each made only when it is reached (the first that finds something ends the search). */
export function* views(img: Picture, turns: number[], make: Makers = browser): Generator<View> {
  if (needsCleaning(make.light(img))) for (const side of CLEAN_SIDES) yield { picture: make.cleaned(img, side), back: (p) => p, how: 'cleaned', quarters: 0 };
  yield { picture: img, back: (p) => p, how: 'as-is', quarters: 0 };
  for (const q of turns) yield { picture: make.turned(img, q), back: (p) => unrotate(p, q), how: 'turned', quarters: q };
  yield { picture: make.shrunk(img), back: (p) => fromShrunk(p), how: 'shrunk', quarters: 0 };
  for (const c of CROPS) yield { picture: make.cropped(img, c), back: (p) => fromCrop(p, c), how: 'zoomed', quarters: 0 };
}

// ── The browser's pictures ────────────────────────────────────────────────────────────────────────────────────────
export const sizeOf = (img: Picture) => ({ w: (img as HTMLImageElement).naturalWidth || img.width, h: (img as HTMLImageElement).naturalHeight || img.height });
const canvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });

/** The photo turned `quarters` × 90° clockwise. */
export function turned(img: Picture, quarters: number): HTMLCanvasElement {
  const { w, h } = sizeOf(img);
  const side = quarters % 2 === 1;
  const c = canvas(side ? h : w, side ? w : h);
  const g = c.getContext('2d')!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((quarters * Math.PI) / 2);
  g.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

/** The colour round the photo's edge (its border, averaged), for the shrunk look's margin. */
function edgeColour(img: Picture): string {
  const c = canvas(8, 8), g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data;
  let r = 0, gr = 0, b = 0, n = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (x === 0 || y === 0 || x === 7 || y === 7) { const i = (y * 8 + x) * 4; r += d[i]!; gr += d[i + 1]!; b += d[i + 2]!; n++; }
  return `rgb(${Math.round(r / n)},${Math.round(gr / n)},${Math.round(b / n)})`;
}

function shrunk(img: Picture): HTMLCanvasElement {
  const { w, h } = sizeOf(img);
  const c = canvas(w, h), g = c.getContext('2d')!;
  g.fillStyle = edgeColour(img);
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, (w * (1 - SHRINK)) / 2, (h * (1 - SHRINK)) / 2, w * SHRINK, h * SHRINK);
  return c;
}

const brightnessOf = (d: Uint8ClampedArray) => { const b = new Uint8Array(d.length / 4); for (let i = 0; i < b.length; i++) b[i] = (d[i * 4]! * 299 + d[i * 4 + 1]! * 587 + d[i * 4 + 2]! * 114) / 1000; return b; };

/** The photo's mean brightness (from a small copy) and its grain (the middle, up to 256 × 256 pixels at full size). */
function light(img: Picture): Light {
  const { w, h } = sizeOf(img);
  const small = canvas(64, 64), sg = small.getContext('2d')!;
  sg.drawImage(img, 0, 0, 64, 64);
  const all = brightnessOf(sg.getImageData(0, 0, 64, 64).data);
  const side = Math.min(256, w, h), mid = canvas(side, side), mg = mid.getContext('2d')!;
  mg.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, side, side);
  return { brightness: all.reduce((a, v) => a + v, 0) / all.length / 255, grain: grainOf(brightnessOf(mg.getImageData(0, 0, side, side).data), side) };
}

function cleaned(img: Picture, side: number): HTMLCanvasElement {
  const { w, h } = sizeOf(img);
  const k = Math.min(1, side / Math.max(w, h));
  const c = canvas(w * k, h * k), g = c.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height), d = data.data;
  const { lo, hi, gamma } = levelsOf(brightnessOf(d));
  const curve = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) curve[v] = 255 * Math.pow(Math.max(0, Math.min(1, (v / 255 - lo) / (hi - lo))), gamma);
  for (let i = 0; i < d.length; i += 4) { d[i] = curve[d[i]!]!; d[i + 1] = curve[d[i + 1]!]!; d[i + 2] = curve[d[i + 2]!]!; }
  g.putImageData(data, 0, 0);
  return c;
}

function cropped(img: Picture, r: Rect): HTMLCanvasElement {
  const { w, h } = sizeOf(img);
  const c = canvas(w * r.w, h * r.h);
  c.getContext('2d')!.drawImage(img, w * r.x, h * r.y, w * r.w, h * r.h, 0, 0, c.width, c.height);
  return c;
}

export const browser: Makers = { light, cleaned, turned, shrunk, cropped };
