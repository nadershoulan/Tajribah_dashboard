// The glasses cut-out from the real photo (Unsplash 62rTkfxLTDg): the front frame only. Each lens's inner
// edge is fitted as an ellipse; inside it is transparent (clear lens — the arms seen through it would not
// be seen when worn); only the rim band, the bridge and the hinges are kept, alpha from how dark a pixel
// is. Colours are the photo's own.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
// sharp from the sibling platform install (this site has no native image tools of its own).
const sharp = require(fileURLToPath(new URL('../../tajribah-platform/node_modules/sharp', import.meta.url)));
// node scripts/cut-glasses.mjs <the Unsplash 62rTkfxLTDg download, 3000 px wide> public/assets/glasses-front.png (then resize to 1200)
const [src, out] = process.argv.slice(2);
const CROP = { left: 480, top: 1100, width: 1960, height: 510 };
const { data, info } = await sharp(src).extract(CROP).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const lum = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) lum[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
const DARK = 120;

/** Least-squares conic A x² + B xy + C y² + D x + E y = 1 (coordinates centred), via normal equations. */
function fitConic(pts, c) {
  const M = Array.from({ length: 5 }, () => new Array(6).fill(0));
  for (const [x0, y0] of pts) {
    const x = x0 - c[0], y = y0 - c[1];
    const row = [x * x, x * y, y * y, x, y];
    for (let i = 0; i < 5; i++) { for (let j = 0; j < 5; j++) M[i][j] += row[i] * row[j]; M[i][5] += row[i]; }
  }
  for (let i = 0; i < 5; i++) { // Gauss-Jordan
    let p = i; for (let r = i + 1; r < 5; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < 5; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let k = i; k < 6; k++) M[r][k] -= f * M[i][k]; }
  }
  const k = M.map((r, i) => r[5] / r[i]);
  return (x0, y0) => { const x = x0 - c[0], y = y0 - c[1]; return k[0] * x * x + k[1] * x * y + k[2] * y * y + k[3] * x + k[4] * y; };
}

const lenses = [{ cx: 925 - CROP.left, cy: 1350 - CROP.top }, { cx: 1970 - CROP.left, cy: 1352 - CROP.top }];
const fits = lenses.map((L) => {
  let pts = [];
  for (let a = 0; a < 360; a += 0.5) {
    const dx = Math.cos((a * Math.PI) / 180), dy = Math.sin((a * Math.PI) / 180);
    const runs = []; let inRun = false, start = 0;
    for (let r = 5; r < 560; r++) {
      const x = Math.round(L.cx + dx * r), y = Math.round(L.cy + dy * r);
      if (x < 0 || y < 0 || x >= W || y >= H) { if (inRun) runs.push([start, r]); inRun = false; break; }
      const d = lum[y * W + x] < DARK;
      if (d && !inRun) { inRun = true; start = r; }
      if (!d && inRun) { inRun = false; runs.push([start, r]); }
    }
    const rim = runs.filter(([s, e]) => e - s >= 6).pop();
    if (rim) pts.push([L.cx + dx * rim[0], L.cy + dy * rim[0]]);
  }
  // Fit, drop the worst fifth (bites, arms, pads), fit again — twice.
  let f = fitConic(pts, [L.cx, L.cy]);
  for (let round = 0; round < 2; round++) {
    const scored = pts.map((p) => [p, Math.abs(f(p[0], p[1]) - 1)]).sort((a, b) => a[1] - b[1]);
    pts = scored.slice(0, Math.floor(scored.length * 0.8)).map((s) => s[0]);
    f = fitConic(pts, [L.cx, L.cy]);
  }
  return f;
});

// Rim band: between the inner ellipse and the same ellipse grown ~ 30 px (conic value 1 → ~1.17).
const rgba = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const v = fits.map((f) => f(x, y));
  const insideLens = v.some((q) => q < 0.985);
  const inBand = v.some((q) => q >= 0.985 && q < 1.2);
  const bridge = x > 790 && x < 1390 && y > 150 && y < 340; // between the lenses
  const hinge = (x < 140 || x > W - 150) && y > 140 && y < 330; // the two end pieces
  const keep = !insideLens && (inBand || bridge || hinge);
  const a = keep ? Math.max(0, Math.min(1, (165 - lum[i]) / 95)) : 0;
  rgba[i * 4] = data[i * 3]; rgba[i * 4 + 1] = data[i * 3 + 1]; rgba[i * 4 + 2] = data[i * 3 + 2];
  rgba[i * 4 + 3] = Math.round(a * 255);
}
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).trim({ threshold: 1 }).png({ compressionLevel: 9 }).toFile(out);
const m = await sharp(out).metadata();
console.log('out', m.width, m.height);
