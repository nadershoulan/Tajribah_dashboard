// The handbag cut-out from the real photo (Pexels 26610519, Amjed wani): an embroidered tan handbag on a
// light grey sweep. Kept: what is warm or dark (the bag, its handles, the embroidery); the sweep and its
// shadow are near-neutral grey — dropped wherever they are, so the light through the handles goes too.
// Small gaps closed; colours are the photo's own, only alpha computed.
// node scripts/cut-bag.mjs <the Pexels download, 6000 px wide> <out.png>
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
// sharp from the sibling platform install (this site has no native image tools of its own).
const sharp = require(fileURLToPath(new URL('../../tajribah-platform/node_modules/sharp', import.meta.url)));
const [src, out] = process.argv.slice(2);
const { data, info } = await sharp(src).resize(3000).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const bag = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max ? (max - min) / max : 0;
  bag[i] = (sat > 0.16 && r > b) || max < 70 ? 1 : 0; // warm, or dark (stitching, shadowed handle)
}
const morph = (m, rad, grow) => {
  const tmp = new Uint8Array(N), dst = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = grow ? 0 : 1;
    for (let k = -rad; k <= rad && (grow ? !v : v); k++) { const xx = x + k; if (xx >= 0 && xx < W) v = m[y * W + xx]; else if (!grow) v = 0; }
    tmp[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = grow ? 0 : 1;
    for (let k = -rad; k <= rad && (grow ? !v : v); k++) { const yy = y + k; if (yy >= 0 && yy < H) v = tmp[yy * W + x]; else if (!grow) v = 0; }
    dst[y * W + x] = v;
  }
  return dst;
};
const mask = morph(morph(morph(morph(bag, 2, false), 2, true), 4, true), 4, false); // open, then close
// Keep only the largest connected piece: the bag (specks of warm floor or noise go).
const label = new Int32Array(N).fill(-1);
let best = -1, bestSize = 0;
for (let s = 0, id = 0; s < N; s++) {
  if (!mask[s] || label[s] >= 0) continue;
  const part = [s]; label[s] = id;
  for (let k = 0; k < part.length; k++) {
    const i = part[k], x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
      if (j < 0 || j >= N || !mask[j] || label[j] >= 0) continue;
      label[j] = id; part.push(j);
    }
  }
  if (part.length > bestSize) { bestSize = part.length; best = id; }
  id++;
}
const rgba = Buffer.alloc(N * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  let s = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += label[yy * W + xx] === best ? 1 : 0; n++; } }
  rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2];
  rgba[i * 4 + 3] = Math.round((label[i] === best ? s / n : (s / n) * 0.5) * 255);
}
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toFile(out);
const m = await sharp(out).metadata();
console.log('out', m.width, m.height);
