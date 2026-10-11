/**
 * T134.1 — the shadow a product casts, so it sits *on* the skin instead of being pasted over the photo (Nader,
 * 2026-10-11, from a reference of a watch on a model's wrist).
 *
 * Two layers, the way a real object on skin is lit: a **contact** shadow — tight and dark, just where it touches — and
 * an **ambient** one — wide, soft and faint. Both take the product's own shape (its transparency), so a round case
 * casts a round shadow and the gaps in a chain cast none. The light comes from above, a little to the side: shadows
 * fall down and slightly away, whatever angle the product is turned to. Each kind has its own amounts — a ring hugs
 * its finger, glasses throw a faint shadow onto the face a little below the frame, a bag casts a long soft one.
 *
 * `shadowLayers` is pure (tested); `castShadow` draws them on a canvas, in screen space, from the product exactly as it
 * is drawn — turned, zoomed — so the studio calls it with the same pose it then draws the product with.
 */

export type ShadowKind = 'watch' | 'eyewear' | 'ring' | 'necklace' | 'bag' | 'earring' | 'flat';
export type ShadowLayer = { blur: number; offsetX: number; offsetY: number; alpha: number };

/** Per kind: [contact, ambient] as shares of the product's drawn width (blur, offsets) and opacity. */
const RECIPES: Record<ShadowKind, [ShadowLayer, ShadowLayer]> = {
  watch: [{ blur: 0.04, offsetX: 0.01, offsetY: 0.03, alpha: 0.5 }, { blur: 0.16, offsetX: 0.03, offsetY: 0.09, alpha: 0.28 }],
  ring: [{ blur: 0.05, offsetX: 0.01, offsetY: 0.03, alpha: 0.5 }, { blur: 0.12, offsetX: 0.02, offsetY: 0.06, alpha: 0.18 }],
  eyewear: [{ blur: 0.012, offsetX: 0.004, offsetY: 0.025, alpha: 0.2 }, { blur: 0.05, offsetX: 0.01, offsetY: 0.06, alpha: 0.12 }],
  necklace: [{ blur: 0.015, offsetX: 0.004, offsetY: 0.012, alpha: 0.35 }, { blur: 0.05, offsetX: 0.008, offsetY: 0.03, alpha: 0.14 }],
  earring: [{ blur: 0.06, offsetX: 0.02, offsetY: 0.05, alpha: 0.3 }, { blur: 0.14, offsetX: 0.03, offsetY: 0.1, alpha: 0.12 }],
  bag: [{ blur: 0.03, offsetX: 0.01, offsetY: 0.025, alpha: 0.3 }, { blur: 0.16, offsetX: 0.05, offsetY: 0.12, alpha: 0.22 }],
  // the flat shot lying on the comparison grid, like an object on a table
  flat: [{ blur: 0.02, offsetX: 0.005, offsetY: 0.015, alpha: 0.28 }, { blur: 0.1, offsetX: 0.015, offsetY: 0.05, alpha: 0.14 }],
};

/** The layers for a product of this kind drawn `widthPx` wide on screen (pixels), contact first. */
export function shadowLayers(kind: ShadowKind, widthPx: number): ShadowLayer[] {
  const w = Math.max(0, widthPx);
  return RECIPES[kind].map((l) => ({
    blur: Math.max(1, l.blur * w),
    offsetX: l.offsetX * w,
    offsetY: Math.max(1, l.offsetY * w),
    alpha: l.alpha,
  }));
}

/** How far away the product is drawn so only its shadow lands on the canvas (the shadow is offset back). */
const FAR = 20_000;

/**
 * Cast the product's shadows on `ctx`, under where it will be drawn. `pose`: its centre, drawn width and height and
 * angle in the canvas's current coordinates (the studio's zoom applies); the shadows are worked out in screen pixels.
 * Draw the product itself afterwards, with no canvas shadow of its own.
 */
export function castShadow(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  pose: { x: number; y: number; width: number; height: number; angle: number },
  kind: ShadowKind,
): void {
  const t = ctx.getTransform();
  const scale = Math.hypot(t.a, t.b) || 1;
  // the product, turned and zoomed as it will be, on its own layer the size of the canvas
  const layer = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height) : Object.assign(document.createElement('canvas'), { width: ctx.canvas.width, height: ctx.canvas.height });
  const lctx = layer.getContext('2d') as CanvasRenderingContext2D | null;
  if (!lctx) return;
  lctx.setTransform(t);
  lctx.translate(pose.x, pose.y);
  lctx.rotate((pose.angle * Math.PI) / 180);
  lctx.drawImage(image, -pose.width / 2, -pose.height / 2, pose.width, pose.height);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const l of shadowLayers(kind, pose.width * scale)) {
    ctx.shadowColor = `rgba(16, 22, 28, ${l.alpha})`;
    ctx.shadowBlur = l.blur;
    ctx.shadowOffsetX = l.offsetX + FAR;
    ctx.shadowOffsetY = l.offsetY;
    ctx.drawImage(layer as CanvasImageSource, -FAR, 0);
  }
  ctx.restore();
}

/**
 * T134.3 — the same two shadows as a CSS `filter` (the phone page draws the product as an image over the photo, not
 * on a canvas). Put it on an element that is *not* turned, around the turned product, so the light stays above
 * whatever the angle — as on the canvas. CSS's blur radius is the canvas's shadow blur (both twice the spread).
 */
export function cssShadow(kind: ShadowKind, widthPx: number): string {
  return shadowLayers(kind, widthPx)
    .map((l) => `drop-shadow(${l.offsetX.toFixed(1)}px ${l.offsetY.toFixed(1)}px ${l.blur.toFixed(1)}px rgba(16, 22, 28, ${l.alpha}))`)
    .join(' ');
}

/**
 * T134.1 — the edge blend: a cut-out's outline is razor sharp, a real object's edge in a photo is not. The product's
 * outline is softened by about a pixel of the picture as it is drawn (its width sets how much, within 0.6–2 px), so
 * it reads as photographed with the skin rather than pasted over it. Inward only — nothing grows past the outline.
 */
export function featherRadius(widthPx: number): number {
  return Math.min(2, Math.max(0.6, widthPx * 0.0035));
}

type Canvasish = HTMLCanvasElement | OffscreenCanvas;
const softCache = new WeakMap<object, { radius: number; canvas: Canvasish }>();
/** The largest side the blend is worked at (a product picture bigger than this is worked smaller). */
const WORK_MAX = 2048;

/**
 * The product with its outline softened by `featherRadius` of the size it is seen at (`widthPx`, the canvas's zoom
 * included); draw it where the product goes, at its usual size. Worked at the picture's own resolution, so the inside
 * stays exactly as sharp as before (one downscale, as always) — only the outline changes. The radius in the
 * picture's pixels hardly changes as the product is resized, so dragging, turning and resizing make nothing new.
 * A picture not loaded, or no canvas to work on: the product as it is.
 */
export function softEdged(image: CanvasImageSource, widthPx: number): CanvasImageSource {
  const size = image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const nw = size.naturalWidth || Number(size.width) || 0, nh = size.naturalHeight || Number(size.height) || 0;
  if (!nw || !nh || !(widthPx > 0)) return image;
  const k = Math.min(1, WORK_MAX / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
  const radius = Math.max(0.25, Math.round(featherRadius(widthPx) * (w / widthPx) * 4) / 4);
  const kept = softCache.get(image as object);
  if (kept && kept.radius === radius) return kept.canvas;
  const make = (): Canvasish => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
  const out = make(), mask = make();
  const o = out.getContext('2d') as CanvasRenderingContext2D | null, m = mask.getContext('2d') as CanvasRenderingContext2D | null;
  if (!o || !m) return image;
  o.drawImage(image, 0, 0, w, h);
  // the outline blurred, as a canvas shadow (every browser has one — a canvas `filter` is not everywhere); twice, so
  // the inside stays whole and thin parts (a chain, a frame's arm) keep their body
  m.shadowColor = '#000';
  m.shadowBlur = radius * 2;
  m.shadowOffsetX = FAR;
  m.drawImage(out as CanvasImageSource, -FAR, 0);
  m.drawImage(out as CanvasImageSource, -FAR, 0);
  o.globalCompositeOperation = 'destination-in';
  o.drawImage(mask as CanvasImageSource, 0, 0);
  softCache.set(image as object, { radius, canvas: out });
  return out as CanvasImageSource;
}
