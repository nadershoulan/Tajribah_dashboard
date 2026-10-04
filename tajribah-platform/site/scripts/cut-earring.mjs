// The earring cut-out from the real photo (Pexels 20943477, The Glorious Studio): a pair of diamond-set
// gold huggie hoops on a light grey sweep; the right-hand hoop stands upright, seen from the front as it
// hangs. Kept: the gold (warm), anything dark (facets, shadowed claws), and the white stones — the sweep's
// colour, so found by lying deep inside the hoop's band; the sweep inside the hoop and outside is dropped. Colours are the photo's own, only alpha computed.
// node site/scripts/cut-earring.mjs <the Pexels download, 5992 px square> <out.webp>
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const sharp = require(fileURLToPath(new URL('../../node_modules/sharp', import.meta.url)));
const [src, out] = process.argv.slice(2);
// The standing hoop, measured on a grid over the full photo.
const CROP = { left: 3500, top: 1640, width: 1520, height: 2440 };
const { data, info } = await sharp(src).extract(CROP).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;

const solid = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max ? (max - min) / max : 0;
  // gold (even the pale, polished hinge: the sweep is neutral grey, r = g = b), or dark (facets, shadow)
  solid[i] = (sat > 0.2 && r > b) || r - b > 14 || max < 165 ? 1 : 0;
}

/** Distance (chamfer 3-4, in thirds of a pixel) from each pixel to the nearest pixel where `target` is set. */
function distanceTo(target) {
  const INF = 1 << 29, d = new Int32Array(N);
  for (let i = 0; i < N; i++) d[i] = target[i] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) { v = Math.min(v, d[i - W] + 3); if (x > 0) v = Math.min(v, d[i - W - 1] + 4); if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4); }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = d[i];
    if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < H - 1) { v = Math.min(v, d[i + W] + 3); if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4); if (x > 0) v = Math.min(v, d[i + W - 1] + 4); }
    d[i] = v;
  }
  return d;
}
/** Round dilation (grow) or erosion by `rad` pixels. */
function morph(m, rad, grow) {
  const out = new Uint8Array(N);
  if (grow) { const d = distanceTo(m); for (let i = 0; i < N; i++) out[i] = d[i] <= rad * 3 ? 1 : 0; }
  else { const inv = new Uint8Array(N); for (let i = 0; i < N; i++) inv[i] = m[i] ? 0 : 1; const d = distanceTo(inv); for (let i = 0; i < N; i++) out[i] = d[i] > rad * 3 ? 1 : 0; }
  return out;
}
const closed = morph(morph(solid, 30, true), 30, false); // the gaps between claws closed

// The stones are the sweep's colour, so they are found by where they are: inside the closed band of the
// hoop. Toward the outside the band must be CORE px deep (the sweep between the outer claws is not kept);
// toward the inside of the hoop its own edge is used, since stones there meet the opening with no gold
// between. The gold's own edge is kept everywhere, so the outline stays crisp.
const CORE = 8;
const outside = new Uint8Array(N);
{
  const queue = new Int32Array(N); let head = 0, tail = 0;
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const p = y * W + x; if (!closed[p] && !outside[p]) { outside[p] = 1; queue[tail++] = p; } }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const p = y * W + x; if (!closed[p] && !outside[p]) { outside[p] = 1; queue[tail++] = p; } }
  while (head < tail) {
    const p = queue[head++], x = p % W;
    for (const q of [p - 1, p + 1, p - W, p + W]) {
      if (q < 0 || q >= N || (q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
      if (!closed[q] && !outside[q]) { outside[q] = 1; queue[tail++] = q; }
    }
  }
}
const fromOutside = distanceTo(outside);
const keep = new Uint8Array(N);
for (let i = 0; i < N; i++) keep[i] = closed[i] && fromOutside[i] > CORE * 3 ? 1 : 0;
if (process.env.DEBUG_DIR) { for (const [name, m] of [['solid', solid], ['closed', closed], ['keep', keep]]) await sharp(Buffer.from(m.map((v) => v * 255)), { raw: { width: W, height: H, channels: 1 } }).resize(400).png().toFile(`${process.env.DEBUG_DIR}/${name}.png`); }
const alpha = Buffer.alloc(N);
for (let i = 0; i < N; i++) alpha[i] = solid[i] || keep[i] ? 255 : 0;
// Small clear spots the earring surrounds (a facet as light as the sweep) are filled; the hoop's inside is not small.
{
  const seen = new Uint8Array(N), queue = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (alpha[s] || seen[s]) continue;
    let head = 0, tail = 0, border = false;
    queue[tail++] = s; seen[s] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % W, y = (p - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= N || (q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
        if (!alpha[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; }
      }
    }
    if (!border && tail < 6000) for (let k = 0; k < tail; k++) alpha[queue[k]] = 255;
  }
}

const rgba = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2]; rgba[i * 4 + 3] = alpha[i]; }
const softened = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } }).blur(1.2).extractChannel(0).raw().toBuffer();
for (let i = 0; i < N; i++) rgba[i * 4 + 3] = softened[i];
const trimmed = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
await sharp(trimmed.data).resize({ height: 900 }).webp({ quality: 90, alphaQuality: 100 }).toFile(out);
const meta = await sharp(out).metadata();
console.log('earring', `${trimmed.info.width}x${trimmed.info.height} in the photo →`, `${meta.width}x${meta.height}`, out);
