// The ring cut-out from the real photo (Pexels 12194367, Melike B): a gold ring on a white display roll,
// seen as it is worn — the band across a cylinder, the stones on top. The gold is found by its colour;
// small gaps are closed, the background flood-filled from the edges, and what it cannot reach (the gold
// and the stones it encloses) is kept. Colours are the photo's own; only alpha is computed.
// node scripts/cut-ring.mjs <the Pexels download, 2383 px wide> <out.png>
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
// sharp from the sibling platform install (this site has no native image tools of its own).
const sharp = require(fileURLToPath(new URL('../../tajribah-platform/node_modules/sharp', import.meta.url)));
const [src, out] = process.argv.slice(2);
const CROP = { left: 980, top: 760, width: 560, height: 660 };
const { data, info } = await sharp(src).extract(CROP).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;

// Gold: warm and saturated (the roll and the card are near-neutral white and grey).
const gold = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max ? (max - min) / max : 0;
  gold[i] = r >= g && g > b && sat > 0.3 && max > 60 ? 1 : 0;
}
const morph = (src, r, grow) => { // square dilation (grow) or erosion
  const tmp = new Uint8Array(N), dst = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = grow ? 0 : 1;
    for (let k = -r; k <= r && (grow ? !v : v); k++) { const xx = x + k; if (xx >= 0 && xx < W) v = grow ? src[y * W + xx] : src[y * W + xx]; else if (!grow) v = 0; }
    tmp[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = grow ? 0 : 1;
    for (let k = -r; k <= r && (grow ? !v : v); k++) { const yy = y + k; if (yy >= 0 && yy < H) v = tmp[yy * W + x]; else if (!grow) v = 0; }
    dst[y * W + x] = v;
  }
  return dst;
};
const closed = morph(morph(gold, 7, true), 7, false);
// The two settings: their halos are mostly white stones, so they do not enclose the centre stone in
// gold. Each is filled as the circle it is (measured on the photo, crop pixels); and the band is cut
// where it goes under the roll (below that is the roll's shadow).
const HALOS = [{ cx: 170, cy: 223, r: 92 }, { cx: 373, cy: 153, r: 95 }];
const BAND_END = 556;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (HALOS.some((h) => (x - h.cx) ** 2 + (y - h.cy) ** 2 <= h.r ** 2)) closed[y * W + x] = 1;
  if (y > BAND_END) closed[y * W + x] = 0;
}

// Background: flood from the border through anything that is not (closed) gold.
const bg = new Uint8Array(N);
const stack = [];
for (let x = 0; x < W; x++) { stack.push(x, (H - 1) * W + x); }
for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
while (stack.length) {
  const i = stack.pop();
  if (bg[i] || closed[i]) continue;
  bg[i] = 1;
  const x = i % W, y = (i - x) / W;
  if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1);
  if (y > 0) stack.push(i - W); if (y < H - 1) stack.push(i + W);
}
// Roll surface boxed in between the settings and the band: a large patch that is neither gold nor a
// setting nor the band's pavé strip (measured on the photo; its white stones stay).
const BAND = [[286, 218], [354, 218], [300, 560], [216, 560]];
const inBand = (x, y) => { // point in the convex quadrilateral
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const [x1, y1] = BAND[k], [x2, y2] = BAND[(k + 1) % 4];
    const c = Math.sign((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1));
    if (c && sign && c !== sign) return false;
    if (c) sign = c;
  }
  return true;
};
const inHalo = (i) => { const x = i % W, y = (i - x) / W; return inBand(x, y) || HALOS.some((h) => (x - h.cx) ** 2 + (y - h.cy) ** 2 <= h.r ** 2); };
const seen = new Uint8Array(N);
for (let start = 0; start < N; start++) {
  if (seen[start] || bg[start] || gold[start] || inHalo(start)) continue;
  const part = [start]; seen[start] = 1;
  for (let k = 0; k < part.length; k++) {
    const i = part[k], x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= N || seen[j] || bg[j] || gold[j] || inHalo(j)) continue;
      seen[j] = 1; part.push(j);
    }
  }
  if (part.length > 900) for (const i of part) bg[i] = 1;
}
// Soft edge: a 1-px feather of the kept region.
const keep = new Float32Array(N);
for (let i = 0; i < N; i++) keep[i] = bg[i] ? 0 : 1;
const alpha = new Float32Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let s = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += keep[yy * W + xx]; n++; } }
  alpha[y * W + x] = keep[y * W + x] ? s / n : (s / n) * 0.5;
}
const rgba = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = Math.round(alpha[i] * 255); }
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toFile(out);
const m = await sharp(out).metadata();
console.log('out', m.width, m.height);
