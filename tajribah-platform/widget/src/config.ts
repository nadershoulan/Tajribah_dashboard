/**
 * P1.16 — the viewer config a product page receives, version 1.
 *
 * Rendered by the dashboard when a merchant publishes (P1.15) into an immutable JSON blob on
 * the edge; read by the widget in the shopper's browser. It is the *only* thing the two sides
 * share, so it is checked strictly here: an unknown version, a missing model, an insecure URL
 * or a malformed field means `null`, and the widget shows nothing (fails closed) — a broken
 * button inside someone else's shop is worse than no button.
 *
 * No dependencies: this ships to every product page, inside a 60 KB budget.
 */
export const CONFIG_VERSION = 1;

export type Placement = 'floor' | 'wall' | 'table' | 'face' | 'wrist';

export type ViewerConfig = {
  v: 1;
  product: { name: string; nameAr: string | null; widthMm: number | null; heightMm: number | null };
  /**
   * `glb`: the web file (meshopt, later KTX2) for `<model-viewer>`. `glbNative`: a plain GLB
   * for Android's Scene Viewer, which reads neither compression; null when none could be made.
   * `usdz`: iPhone Quick Look. Both optional fields were added without a version bump: an
   * older widget ignores them, and no config has been published yet (P1.15).
   *
   * P1.15: null for a watch offered only in the owner's try-on (T33: every plan has the studio; many
   * watches have no 3D model). Then the placement is `wrist` and `tryon` is set, so the button
   * always opens something.
   */
  model: { glb: string; glbNative: string | null; usdz: string | null } | null;
  button: { labelAr: string; labelEn: string; color: string; radius: number; variant: 'solid' | 'outline'; icon: boolean };
  placement: Placement;
  scale: number;
  autoRotate: boolean;
  shadow: number;
  /**
   * P5 (T26): the watch try-on — the cut-out photos and case width the owner's studio needs.
   * Optional and added without a version bump (like `glbNative`); a malformed block only turns
   * try-on off, the AR button still works.
   */
  /** `onMe` (T33): the shopper may also try it on their own photo — Pro and up; anything but `true` is off. */
  /** `category`: 'glasses' (P5.2: placement `face`, 100–170 mm), 'ring' (P5.4: `wrist`, 14–30 mm) or 'necklace' (P5.5: `wrist`, 60–300 mm); absent = a watch (`wrist`, 5–80 mm). */
  tryon: { category?: 'glasses' | 'ring' | 'necklace' | 'bag'; worn: string; flat: string; caseMm: number; sku: string | null; onMe: boolean } | null;
  /**
   * T62 (custom domains): the store's own address for the try-on, once it is switched on — the frame
   * opens there instead of on Tajribah's. Optional, added without a version bump; anything but a
   * plain hostname is ignored (the try-on then opens on Tajribah's address, as before).
   */
  host: string | null;
};

/** A config with a 3D model — what AR and the in-page viewer need. */
export type ModelConfig = ViewerConfig & { model: NonNullable<ViewerConfig['model']> };
export const hasModel = (config: ViewerConfig): config is ModelConfig => config.model !== null;

const PLACEMENTS: readonly string[] = ['floor', 'wall', 'table', 'face', 'wrist'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
/** Only https (and our own relative paths are not allowed either — the page's origin is not ours). */
const httpsUrl = (v: unknown): v is string => {
  if (!str(v, 2048)) return false;
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
};

/**
 * A plain hostname of three labels or more (a store's subdomain), or null. Never a URL, a path or a
 * port. No look-behind in the pattern: older Safari cannot parse one, and the whole script would fail.
 */
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME = new RegExp(`^(?:${LABEL}\\.){2,}${LABEL}$`);
export function hostOf(v: unknown): string | null {
  return typeof v === 'string' && v.length <= 253 && HOSTNAME.test(v) && !/^\d+$/.test(v.slice(v.lastIndexOf('.') + 1)) ? v : null;
}

/** The try-on widths a config may carry: a watch's case, or (P5.2) a frame's front. */
export const TRYON_WIDTH_MM = { watch: [5, 80], glasses: [100, 170], ring: [14, 30], necklace: [60, 300], bag: [100, 600] } as const;

/** The try-on block, or null when it is absent, wrong, or not for this placement. */
function tryOnOf(v: unknown, placement: unknown): ViewerConfig['tryon'] {
  if (!isObj(v) || !httpsUrl(v.worn) || !httpsUrl(v.flat)) return null;
  const kind = v.category === undefined ? 'watch' : v.category === 'glasses' || v.category === 'ring' || v.category === 'necklace' || v.category === 'bag' ? v.category : null;
  if (!kind) return null; // a kind this widget does not know
  // P5.6: a bag goes wherever a bag's button goes (not the face or the wrist)
  if (kind === 'bag' ? placement === 'face' || placement === 'wrist' : placement !== (kind === 'glasses' ? 'face' : 'wrist')) return null;
  const [lo, hi] = TRYON_WIDTH_MM[kind];
  if (!num(v.caseMm, lo, hi)) return null;
  if (!(v.sku === null || v.sku === undefined || str(v.sku, 64))) return null;
  return { ...(kind !== 'watch' ? { category: kind } : {}), worn: v.worn, flat: v.flat, caseMm: v.caseMm, sku: (v.sku as string | null | undefined) ?? null, onMe: v.onMe === true };
}

/** The config, or null when anything about it is wrong. Never throws. */
export function parseConfig(input: unknown): ViewerConfig | null {
  try {
    if (!isObj(input) || input.v !== CONFIG_VERSION) return null;
    const { product, model, button } = input;
    if (!isObj(product) || !(model === null || isObj(model)) || !isObj(button)) return null;
    if (!str(product.name) || !(product.nameAr === null || str(product.nameAr))) return null;
    const mm = (v: unknown) => (v === null || v === undefined ? null : num(v, 0.1, 3000) ? v : undefined);
    const widthMm = mm(product.widthMm);
    const heightMm = mm(product.heightMm);
    if (widthMm === undefined || heightMm === undefined) return null;
    const optionalUrl = (v: unknown) => v === null || v === undefined || httpsUrl(v);
    if (model !== null && (!httpsUrl(model.glb) || !optionalUrl(model.usdz) || !optionalUrl(model.glbNative))) return null;
    if (!str(button.labelAr, 40) || !str(button.labelEn, 40)) return null;
    if (typeof button.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(button.color)) return null;
    if (!num(button.radius, 0, 24) || (button.variant !== 'solid' && button.variant !== 'outline') || typeof button.icon !== 'boolean') return null;
    if (typeof input.placement !== 'string' || !PLACEMENTS.includes(input.placement)) return null;
    if (!num(input.scale, 0.5, 2) || !num(input.shadow, 0, 2) || typeof input.autoRotate !== 'boolean') return null;
    const tryon = tryOnOf(input.tryon, input.placement);
    // No model: only a product whose try-on is set up — otherwise the button would open nothing.
    if (model === null && !tryon) return null;
    return {
      v: 1,
      product: { name: product.name, nameAr: (product.nameAr as string | null) ?? null, widthMm, heightMm },
      model: model === null ? null : { glb: model.glb as string, glbNative: (model.glbNative as string | null | undefined) ?? null, usdz: (model.usdz as string | null | undefined) ?? null },
      button: { labelAr: button.labelAr, labelEn: button.labelEn, color: button.color, radius: button.radius, variant: button.variant, icon: button.icon },
      placement: input.placement as Placement,
      scale: input.scale,
      autoRotate: input.autoRotate,
      shadow: input.shadow,
      tryon,
      host: hostOf(input.host),
    };
  } catch {
    return null;
  }
}
