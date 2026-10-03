// The necklace cut-out from the real photo (Pexels 20768279, sinu sony): a gold pendant necklace on a teal
// display bust, so the chains hang as they are worn. Kept: what is warm (gold, pearls) or bright and near-
// white (the white stones) — the bust is cool teal and the backdrop near black. Small gaps are closed,
// the background flood-filled from the edges, and what it cannot reach is kept. Colours are the photo's
// own; only alpha is computed. node scripts/cut-necklace.mjs <the Pexels download, 3889 px wide> <out.png>
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
// sharp from the sibling platform install (this site has no native image tools of its own).
const sharp = require(fileURLToPath(new URL('../../tajribah-platform/node_modules/sharp', import.meta.url)));
const [src, out] = process.argv.slice(2);
const CROP = { left: 1000, top: 1480, width: 1950, height: 2330 };
const { data, info } = await sharp(src).extract(CROP).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;

const jewel = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max ? (max - min) / max : 0;
  const warm = r > b + 18 && r >= g - 6 && max > 55;
  const white = max > 165 && sat < 0.22 && r >= b - 8;
  jewel[i] = warm || white ? 1 : 0;
}
const morph = (srcMask, rad, grow) => {
  const tmp = new Uint8Array(N), dst = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = grow ? 0 : 1;
    for (let k = -rad; k <= rad && (grow ? !v : v); k++) { const xx = x + k; if (xx >= 0 && xx < W) v = srcMask[y * W + xx]; else if (!grow) v = 0; }
    tmp[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = grow ? 0 : 1;
    for (let k = -rad; k <= rad && (grow ? !v : v); k++) { const yy = y + k; if (yy >= 0 && yy < H) v = tmp[yy * W + x]; else if (!grow) v = 0; }
    dst[y * W + x] = v;
  }
  return dst;
};
// Open first (drops specks of warm noise on the bust), then close (joins beads and links).
const opened = morph(morph(jewel, 2, false), 2, true);
const closed = morph(morph(opened, 6, true), 6, false);
// The medallion and the two roundels carry dark enamel, neither warm nor bright: each is filled as the
// circle it is (measured on the photo, crop pixels).
const ROUNDS = [{ cx: 1000, cy: 1453, r: 440 }, { cx: 647, cy: 973, r: 140 }, { cx: 1253, cy: 973, r: 140 }];
// Within them everything is kept but the bust's teal (cool: green and blue above red), which shows where
// a circle runs past the element's edge.
const teal = (i) => { // a teal hue (140–220°) with some colour in it — gold and the maroon enamel are 0–45°
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min || (max - min) / max < 0.12) return false;
  const d = max - min;
  const hue = max === r ? ((g - b) / d) * 60 : max === g ? (2 + (b - r) / d) * 60 : (4 + (r - g) / d) * 60;
  const h = (hue + 360) % 360;
  return h >= 140 && h <= 220;
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  if (ROUNDS.some((c) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r ** 2)) closed[i] = teal(i) ? 0 : 1;
}

const bg = new Uint8Array(N);
const stack = [];
for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
while (stack.length) {
  const i = stack.pop();
  if (bg[i] || closed[i]) continue;
  bg[i] = 1;
  const x = i % W, y = (i - x) / W;
  if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1);
  if (y > 0) stack.push(i - W); if (y < H - 1) stack.push(i + W);
}
// Bust showing through openwork (enclosed by gold, so the flood cannot reach it): any teal hole is bust.
for (let i = 0; i < N; i++) if (!closed[i] && teal(i)) bg[i] = 1;
// Holes the flood cannot reach but that are bust, not jewel (between the chains): large cool patches.
const seen = new Uint8Array(N);
for (let start = 0; start < N; start++) {
  if (seen[start] || bg[start] || closed[start]) continue;
  const part = [start]; seen[start] = 1;
  for (let k = 0; k < part.length; k++) {
    const i = part[k], x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= N || seen[j] || bg[j] || closed[j]) continue;
      seen[j] = 1; part.push(j);
    }
  }
  if (part.length > 1500) for (const i of part) bg[i] = 1;
}
const keep = new Float32Array(N);
for (let i = 0; i < N; i++) keep[i] = bg[i] ? 0 : 1;
const rgba = Buffer.alloc(N * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let s = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += keep[yy * W + xx]; n++; } }
  const i = y * W + x;
  rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2];
  rgba[i * 4 + 3] = Math.round((keep[i] ? s / n : (s / n) * 0.5) * 255);
}
// Where the chains go behind the neck they fade over 40 rows rather than stop at a hard edge.
const top = (() => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rgba[(y * W + x) * 4 + 3]) return y; return 0; })();
for (let y = top; y < Math.min(H, top + 40); y++) for (let x = 0; x < W; x++) rgba[(y * W + x) * 4 + 3] = Math.round(rgba[(y * W + x) * 4 + 3] * ((y - top) / 40));
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toFile(out);
const m = await sharp(out).metadata();
console.log('out', m.width, m.height);
