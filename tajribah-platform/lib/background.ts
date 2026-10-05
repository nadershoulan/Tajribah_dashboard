/**
 * T88 — take a plain background off a product picture, in the merchant's browser (the API runs on
 * Workers, where no image library runs). Most store pictures are a product on one flat colour, usually
 * white; that colour is read from the picture's edges, and what is that colour and reaches an edge goes
 * clear — and so does a large patch of it the product encloses (the hole inside a bangle or a ring).
 * Small patches inside the product (a highlight on silver) stay. The product's own edge keeps a soft
 * fade, as a cut-out by hand would.
 *
 * Refused, with the reason, when the edges are not one colour (a photo with a scene behind it) or when
 * nothing would be left. The result goes through the same checks as an uploaded cut-out.
 */

export type Rgba = { data: Uint8ClampedArray; width: number; height: number };
export type BackgroundResult = { ok: true; image: Rgba } | { ok: false; reason: 'not_plain' | 'nothing_left' };

/** Within this distance of the background colour, a pixel is background (0–441 across RGB). */
export const NEAR = 30;
/** Past this distance, an edge pixel is fully the product; in between it fades. */
export const FAR = 90;
/** The share of edge pixels that must be the background colour for the background to count as plain. */
export const PLAIN_SHARE = 0.9;
/** An enclosed patch of background colour this share of the picture or larger is a hole, not a highlight. */
export const HOLE_SHARE = 0.002;

const dist = (d: Uint8ClampedArray, i: number, bg: [number, number, number]) =>
  Math.hypot(d[i * 4]! - bg[0], d[i * 4 + 1]! - bg[1], d[i * 4 + 2]! - bg[2]);

const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

export function removeBackground({ data, width: w, height: h }: Rgba): BackgroundResult {
  const n = w * h;
  const edge: number[] = [];
  for (let x = 0; x < w; x++) edge.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) edge.push(y * w, y * w + w - 1);
  const bg: [number, number, number] = [0, 1, 2].map((c) => median(edge.map((i) => data[i * 4 + c]!))) as [number, number, number];
  if (edge.filter((i) => dist(data, i, bg) <= NEAR).length < edge.length * PLAIN_SHARE) return { ok: false, reason: 'not_plain' };

  const near = new Uint8Array(n);
  for (let i = 0; i < n; i++) near[i] = data[i * 4 + 3]! < 16 || dist(data, i, bg) <= NEAR ? 1 : 0;

  // Background: what is near the colour and connected to an edge; then each enclosed patch large enough to be a hole.
  const clear = new Uint8Array(n);
  const queue = new Int32Array(n);
  const fill = (seeds: number[], mark: Uint8Array, value: number): number[] => {
    let head = 0, tail = 0;
    const filled: number[] = [];
    for (const s of seeds) if (near[s] && !mark[s]) { mark[s] = value; queue[tail++] = s; }
    while (head < tail) {
      const i = queue[head++]!;
      filled.push(i);
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < n && near[j] && !mark[j]) { mark[j] = value; queue[tail++] = j; }
      }
    }
    return filled;
  };
  fill(edge, clear, 1);
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!near[i] || clear[i] || seen[i]) continue;
    const patch = fill([i], seen, 1);
    if (patch.length >= Math.max(64, n * HOLE_SHARE)) for (const j of patch) clear[j] = 1;
  }

  const out = new Uint8ClampedArray(data);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < n; i++) {
    const x = i % w, y = (i - x) / w;
    if (clear[i]) { out[i * 4 + 3] = 0; continue; }
    // the product's edge: a pixel beside the background fades with how close it is to the background colour
    const touches = (x > 0 && clear[i - 1]) || (x < w - 1 && clear[i + 1]) || (y > 0 && clear[i - w]) || (y < h - 1 && clear[i + w]);
    if (touches) {
      const d = dist(data, i, bg);
      const keep = Math.min(1, Math.max(0, (d - NEAR) / (FAR - NEAR)));
      out[i * 4 + 3] = Math.round(data[i * 4 + 3]! * Math.max(keep, 0.35));
    }
    if (out[i * 4 + 3]! > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0 || (x1 - x0 + 1) * (y1 - y0 + 1) < 64) return { ok: false, reason: 'nothing_left' };

  // cropped to the product: the try-on reads the picture's width as the product's
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const cropped = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) cropped.set(out.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4), y * cw * 4);
  return { ok: true, image: { data: cropped, width: cw, height: ch } };
}

export const BACKGROUND_REASONS: Record<'not_plain' | 'nothing_left', { ar: string; en: string }> = {
  not_plain: { ar: 'خلفية هذه الصورة ليست بلون واحد، فلا نستطيع إزالتها تلقائيًا. ارفع صورة مقصوصة من إعدادات التجربة.', en: 'This picture’s background is not one plain colour, so it cannot be taken off automatically. Upload a cut-out in the try-on settings.' },
  nothing_left: { ar: 'لم يبقَ شيء بعد إزالة الخلفية — المنتج بلون الخلفية نفسه تقريبًا. ارفع صورة مقصوصة من إعدادات التجربة.', en: 'Nothing was left once the background was taken off — the product is almost the background’s colour. Upload a cut-out in the try-on settings.' },
};
