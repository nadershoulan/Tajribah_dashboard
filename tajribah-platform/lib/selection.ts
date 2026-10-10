/**
 * T131 — selections for the picture editor, the way Photoshop makes them: the Selection Brush, the Lasso, the
 * Polygonal Lasso and the Magnetic Lasso; combined New / Add / Subtract / Intersect; inverted; feathered. A
 * selection changes no pixel by itself — "Delete" clears what is selected, "Keep only" clears the rest, and that
 * becomes a `Cut` in the picture's edits (undoable, re-applied on the full picture when saving).
 *
 * Everything here is pure, on plain arrays, so the browser and the tests run the same code.
 *
 * **Coordinates.** A shape's points are shares (0…1) of the picture's width and height, and a brush's radius and a
 * feather are shares of its larger side — so a selection drawn on the 640 px preview means exactly the same on the
 * 1 600 px picture that is saved.
 *
 * **The Magnetic Lasso** (Photoshop: Width, Contrast, Frequency): `edgeMap` measures how strongly each pixel is an
 * edge (Sobel on brightness, alpha-aware); `snapToEdge` moves the pointer to the strongest edge within Width;
 * `liveWire` finds the path of least resistance along edges from the last anchor to the pointer (Dijkstra in a box
 * around the two, "intelligent scissors") — edges weaker than Contrast count as no edge. The editor drops an anchor
 * every Frequency pixels of path, as Photoshop does.
 */
import type { Rgba } from './background';

export type { Rgba };

export type Pt = { x: number; y: number };
export type SelShape = { kind: 'polygon'; points: Pt[] } | { kind: 'brush'; points: Pt[]; radius: number };
export type SelMode = 'new' | 'add' | 'subtract' | 'intersect';
export type SelOp = { mode: SelMode; shape: SelShape };
export type Selection = { ops: SelOp[]; inverted: boolean };
/** A selection used: `erase` clears what it selects, `keep` clears everything else. `feather`: share of the larger side. */
export type Cut = { action: 'erase' | 'keep'; selection: Selection; feather: number };

export const EMPTY_SELECTION: Selection = { ops: [], inverted: false };
/** Points kept in one picture's cuts, all shapes together — a guard on what an edit may hold. */
export const MAX_POINTS = 6000;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Add a shape to a selection the way Photoshop does: New replaces, the others combine (and keep the inversion as it is). */
export function addShape(sel: Selection, mode: SelMode, shape: SelShape): Selection {
  if (mode === 'new') return { ops: [{ mode: 'new', shape }], inverted: false };
  return { ops: [...sel.ops, { mode, shape }], inverted: sel.inverted };
}
export const invertSelection = (sel: Selection): Selection => ({ ops: sel.ops, inverted: !sel.inverted });
export const selectAll = (): Selection => ({ ops: [], inverted: true });
export const pointCount = (sels: Selection[]) => sels.reduce((n, s) => n + s.ops.reduce((m, o) => m + o.shape.points.length, 0), 0);

// ------------------------------------------------------------------ rasterising

/** A closed polygon, filled (non-zero winding, pixel centres), into a 0/255 mask. */
function fillPolygon(w: number, h: number, pts: Pt[]): Uint8Array {
  const out = new Uint8Array(w * h);
  if (pts.length < 3) return out;
  const xs = pts.map((p) => clamp01(p.x) * w), ys = pts.map((p) => clamp01(p.y) * h);
  const n = xs.length;
  let minY = h, maxY = 0;
  for (const y of ys) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const crossings: { x: number; dir: number }[] = [];
  for (let row = Math.max(0, Math.floor(minY)); row <= Math.min(h - 1, Math.ceil(maxY)); row++) {
    const cy = row + 0.5;
    crossings.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const y0 = ys[j]!, y1 = ys[i]!;
      if ((y0 <= cy && y1 > cy) || (y1 <= cy && y0 > cy)) {
        const x = xs[j]! + ((cy - y0) / (y1 - y0)) * (xs[i]! - xs[j]!);
        crossings.push({ x, dir: y1 > y0 ? 1 : -1 });
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let k = 0; k < crossings.length - 1; k++) {
      winding += crossings[k]!.dir;
      if (winding === 0) continue;
      const from = Math.max(0, Math.ceil(crossings[k]!.x - 0.5)), to = Math.min(w - 1, Math.floor(crossings[k + 1]!.x - 0.5));
      if (to >= from) out.fill(255, row * w + from, row * w + to + 1);
    }
  }
  return out;
}

/** A brush stroke: discs of `radius` (share of the larger side) stamped along the points, into a 0/255 mask. */
function fillBrush(w: number, h: number, pts: Pt[], radiusShare: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const r = Math.max(0.5, radiusShare * Math.max(w, h));
  const disc = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) { const dx = x + 0.5 - cx; if (dx * dx + dy * dy <= r * r) out[y * w + x] = 255; }
    }
  };
  const px = pts.map((p) => ({ x: clamp01(p.x) * w, y: clamp01(p.y) * h }));
  if (px.length === 1) disc(px[0]!.x, px[0]!.y);
  for (let i = 1; i < px.length; i++) {
    const a = px[i - 1]!, b = px[i]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, r / 3)));
    for (let s = 0; s <= steps; s++) disc(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
  }
  return out;
}

/** The selection as a 0…255 mask of `w`×`h` (255 = selected), before feathering. */
export function rasterize(sel: Selection, w: number, h: number): Uint8Array {
  let mask: Uint8Array = new Uint8Array(w * h);
  for (const op of sel.ops) {
    const shape = op.shape.kind === 'polygon' ? fillPolygon(w, h, op.shape.points) : fillBrush(w, h, op.shape.points, op.shape.radius);
    if (op.mode === 'new') { mask = shape; continue; }
    for (let i = 0; i < mask.length; i++) {
      const a = mask[i]!, b = shape[i]!;
      mask[i] = op.mode === 'add' ? Math.max(a, b) : op.mode === 'subtract' ? Math.round((a * (255 - b)) / 255) : Math.min(a, b);
    }
  }
  if (sel.inverted) for (let i = 0; i < mask.length; i++) mask[i] = 255 - mask[i]!;
  return mask;
}

/** Soften a mask's edge over `radius` pixels (three box blurs ≈ a Gaussian), as Photoshop's Feather. */
export function featherMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const r = Math.round(radius);
  if (r < 1) return mask;
  const a = Float32Array.from(mask);
  const b = new Float32Array(mask.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h, lines = horizontal ? h : w;
    for (let line = 0; line < lines; line++) {
      const at = (i: number) => (horizontal ? line * w + i : i * w + line);
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[at(Math.min(len - 1, Math.max(0, i)))]!;
      for (let i = 0; i < len; i++) {
        dst[at(i)] = sum / (2 * r + 1);
        sum += src[at(Math.min(len - 1, i + r + 1))]! - src[at(Math.max(0, i - r))]!;
      }
    }
  };
  for (let k = 0; k < 3; k++) { pass(a, b, true); pass(b, a, false); }
  return Uint8Array.from(a, (v) => Math.round(v));
}

/** Whether nothing at all is selected. */
export const isEmptyMask = (mask: Uint8Array) => !mask.some((v) => v > 0);

/** Use a cut on a picture: clear what is selected (erase) or everything else (keep), the feather softening the edge. */
export function applyCut(img: Rgba, cut: Cut): Rgba {
  const { width: w, height: h } = img;
  let mask = rasterize(cut.selection, w, h);
  mask = featherMask(mask, w, h, cut.feather * Math.max(w, h));
  const out = new Uint8ClampedArray(img.data);
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i]!;
    const keep = cut.action === 'erase' ? 255 - m : m;
    if (keep < 255) out[i * 4 + 3] = Math.round((out[i * 4 + 3]! * keep) / 255);
  }
  return { data: out, width: w, height: h };
}

/** The pixels on a mask's edge (selected, with an unselected neighbour) — where the marching ants go. */
export function maskOutline(mask: Uint8Array, w: number, h: number): Int32Array {
  const edge: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (mask[i]! < 128) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || mask[i - 1]! < 128 || mask[i + 1]! < 128 || mask[i - w]! < 128 || mask[i + w]! < 128) edge.push(i);
  }
  return Int32Array.from(edge);
}

// ------------------------------------------------------------------ the magnetic lasso

/** How strongly each pixel is an edge, 0…1 (Sobel on brightness over the picture as shown: a clear pixel is dark). */
export function edgeMap(img: Rgba): Float32Array {
  const { width: w, height: h, data } = img;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]! / 255;
    lum[i] = (0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!) * a; // clear reads as black
  }
  const out = new Float32Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = (dx: number, dy: number) => lum[(y + dy) * w + (x + dx)]!;
    const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
    const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
    const g = Math.hypot(gx, gy);
    out[y * w + x] = g;
    if (g > max) max = g;
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = out[i]! / max;
  return out;
}

/** The strongest edge within `radius` pixels of `p` (pixel coordinates); `p` itself when nothing there is an edge. */
export function snapToEdge(edges: Float32Array, w: number, h: number, p: Pt, radius: number, contrast = 0.1): Pt {
  let best = { x: Math.round(p.x), y: Math.round(p.y) }, bestScore = -1;
  const r = Math.max(1, Math.round(radius));
  for (let y = Math.max(0, Math.round(p.y) - r); y <= Math.min(h - 1, Math.round(p.y) + r); y++) {
    for (let x = Math.max(0, Math.round(p.x) - r); x <= Math.min(w - 1, Math.round(p.x) + r); x++) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > r) continue;
      const e = edges[y * w + x]!;
      if (e < contrast) continue;
      const score = e - (d / r) * 0.15; // nearer wins among equals
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return bestScore < 0 ? { x: Math.min(w - 1, Math.max(0, Math.round(p.x))), y: Math.min(h - 1, Math.max(0, Math.round(p.y))) } : best;
}

/**
 * The cheapest path along edges from `from` to `to` (pixels), searched in their bounding box grown by `width`. A pixel
 * costs little when it is a strong edge, the full price when weaker than `contrast`. Returns pixels, from → to.
 */
export function liveWire(edges: Float32Array, w: number, h: number, from: Pt, to: Pt, width = 10, contrast = 0.1): Pt[] {
  const fx = Math.round(from.x), fy = Math.round(from.y), tx = Math.round(to.x), ty = Math.round(to.y);
  const pad = Math.max(2, Math.round(width));
  const x0 = Math.max(0, Math.min(fx, tx) - pad), x1 = Math.min(w - 1, Math.max(fx, tx) + pad);
  const y0 = Math.max(0, Math.min(fy, ty) - pad), y1 = Math.min(h - 1, Math.max(fy, ty) + pad);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, n = bw * bh;
  const local = (x: number, y: number) => (y - y0) * bw + (x - x0);
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  // a binary heap of (cost, index)
  const heapCost: number[] = [], heapIdx: number[] = [];
  const push = (c: number, i: number) => {
    let k = heapCost.length; heapCost.push(c); heapIdx.push(i);
    while (k > 0) { const p = (k - 1) >> 1; if (heapCost[p]! <= c) break; heapCost[k] = heapCost[p]!; heapIdx[k] = heapIdx[p]!; k = p; }
    heapCost[k] = c; heapIdx[k] = i;
  };
  const pop = (): number => {
    const top = heapIdx[0]!;
    const lc = heapCost.pop()!, li = heapIdx.pop()!;
    if (heapCost.length) {
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k, mc = lc;
        if (l < heapCost.length && heapCost[l]! < mc) { m = l; mc = heapCost[l]!; }
        if (r < heapCost.length && heapCost[r]! < mc) { m = r; mc = heapCost[r]!; }
        if (m === k) break;
        heapCost[k] = heapCost[m]!; heapIdx[k] = heapIdx[m]!; k = m;
      }
      heapCost[k] = lc; heapIdx[k] = li;
    }
    return top;
  };
  const cost = (x: number, y: number) => { const e = edges[y * w + x]!; return e < contrast ? 1 : 1 - e + 0.02; };
  const start = local(fx, fy), goal = local(tx, ty);
  dist[start] = 0; push(0, start);
  const STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]] as const;
  while (heapCost.length) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const x = (i % bw) + x0, y = Math.floor(i / bw) + y0;
    for (const [dx, dy, len] of STEPS) {
      const nx = x + dx, ny = y + dy;
      if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      const j = local(nx, ny);
      if (done[j]) continue;
      const c = dist[i]! + cost(nx, ny) * len;
      if (c < dist[j]!) { dist[j] = c; prev[j] = i; push(c, j); }
    }
  }
  const path: Pt[] = [];
  for (let i = goal; i !== -1; i = prev[i]!) { path.push({ x: (i % bw) + x0, y: Math.floor(i / bw) + y0 }); if (i === start) break; }
  return path.reverse();
}

/** Fewer points for the same line (Ramer–Douglas–Peucker, `tolerance` in the points' own units). */
export function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = points[a]!, B = points[b]!;
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1e-9;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const P = points[i]!;
      const d = Math.abs((B.x - A.x) * (A.y - P.y) - (A.x - P.x) * (B.y - A.y)) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
