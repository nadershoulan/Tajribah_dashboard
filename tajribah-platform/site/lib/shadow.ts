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
