/**
 * P1.19 — a product's own page (`/p/{store}/{product}`): one link a merchant shares anywhere, showing
 * the product in 3D with "view in your space", and a watch in the owner's studio.
 *
 * Like the try-on frame, the page reads only the merchant's published config from Tajribah's config
 * host — never anything from its own address — so a link can only ever show what a merchant
 * published, and the page exists exactly while the product is published. The config's `page` block
 * is the merchant's: null when they switched the page off. Checked as strictly as the shop's widget
 * checks a config; the AR path below is the widget's (`widget/src/ar.ts`), copied, and a test in the
 * platform keeps the two equal.
 */
import type { Bi } from './lang';
import type { TryOnProduct } from './demo-product';
import { brandFrom, isLocalHost, tryOnProductFrom, type StoreBrand } from './tryon-config';

/** The 3D viewer the shop's widget loads, from Tajribah's file host. */
export const VIEWER_SRC = 'https://cdn.tajribah.com/vendor/model-viewer-4.0.0.min.js';
/** meshoptimizer's decoder, next to the viewer: every web GLB is meshopt-compressed (P3.5). */
export const MESHOPT_DECODER_FILE = 'meshopt_decoder-1.2.0.js';
/** The in-page viewer's AR modes. No `scene-viewer`: it would be handed the compressed web file. */
export const VIEWER_AR_MODES = 'webxr quick-look';

export type Placement = 'floor' | 'wall' | 'table' | 'face' | 'wrist';
const PLACEMENTS: readonly string[] = ['floor', 'wall', 'table', 'face', 'wrist'];

export type HostedModel = { glb: string; glbNative: string | null; usdz: string | null };

export type HostedProduct = {
  name: Bi;
  widthMm: number | null;
  heightMm: number | null;
  model: HostedModel | null;
  placement: Placement;
  scale: number;
  autoRotate: boolean;
  shadow: number;
  /** The watch for the owner's studio — its store link is the merchant's buy link, when there is one. */
  tryon: TryOnProduct | null;
  store: Bi;
  shopUrl: string | null;
  /** "Made with Tajribah" under the page; off under white-label. */
  poweredBy: boolean;
  /** Enterprise white-label: the store's logo in the bar (only published with a try-on). */
  brand: StoreBrand | null;
  /** A picture for link previews (the watch's flat shot), when there is one. */
  image: string | null;
  /** The store's own address (Enterprise custom domain), when it has one: the page is served there too. */
  host: string | null;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** https only — except a page on this machine may use a local http server (a public page never is local). */
function url(v: unknown, local: boolean): v is string {
  if (!str(v, 2048)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || (local && u.protocol === 'http:' && isLocalHost(u.hostname));
  } catch { return false; }
}

/** The merchant's buy link: https, a real host, no name or password in it (the platform checks the same). */
export function shopLink(v: unknown): string | null {
  if (!str(v, 2048)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.') ? v : null;
  } catch { return null; }
}

/** A plain hostname of three labels or more (a store's subdomain), or null — as the widget reads `host`. */
function hostnameOf(v: unknown): string | null {
  return typeof v === 'string' && v.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v) && !/\.\d+$/.test(v) ? v : null;
}

/** The page's product from a published config, or null — no page (switched off) or anything wrong. */
export function hostedProductFrom(config: unknown, local = false): HostedProduct | null {
  if (!isObj(config) || config.v !== 1 || !isObj(config.product) || !isObj(config.page)) return null;
  const { product, page } = config;
  if (!str(product.name) || !(product.nameAr == null || str(product.nameAr))) return null;
  if (!isObj(page.store) || !str(page.store.name, 80) || !(page.store.nameAr == null || str(page.store.nameAr, 80))) return null;
  const mm = (v: unknown) => (num(v, 0.1, 3000) ? v : null);
  const optional = (v: unknown) => (url(v, local) ? v : null);
  const model = isObj(config.model) && url(config.model.glb, local)
    ? { glb: config.model.glb, glbNative: optional(config.model.glbNative), usdz: optional(config.model.usdz) }
    : null;
  if (typeof config.placement !== 'string' || !PLACEMENTS.includes(config.placement)) return null;
  const shopUrl = shopLink(page.shopUrl);
  const store: Bi = { ar: (page.store.nameAr as string | null | undefined) ?? page.store.name, en: page.store.name };
  const watch = tryOnProductFrom(config, local);
  const tryon = watch && shopUrl ? { ...watch, storeLink: { label: { ar: `اشترها من ${store.ar}`, en: `Buy it at ${store.en}` }, href: shopUrl } } : watch;
  if (!model && !tryon) return null;
  return {
    name: { ar: (product.nameAr as string | null) ?? product.name, en: product.name },
    widthMm: mm(product.widthMm),
    heightMm: mm(product.heightMm),
    model,
    placement: config.placement as Placement,
    scale: num(config.scale, 0.5, 2) ? config.scale : 1,
    autoRotate: config.autoRotate === true,
    shadow: num(config.shadow, 0, 2) ? config.shadow : 1,
    tryon,
    store,
    shopUrl,
    poweredBy: page.poweredBy !== false,
    brand: brandFrom(config, local),
    image: tryon?.flat ?? null,
    host: hostnameOf(page.host),
  };
}

/**
 * Width × height and the unit, or null without both sizes. The numbers are one left-to-right unit
 * (width first in Arabic too); ASCII digits in Arabic as everywhere on the site.
 */
export function sizeParts(p: Pick<HostedProduct, 'widthMm' | 'heightMm'>, lang: 'ar' | 'en'): { dims: string; unit: string } | null {
  if (p.widthMm == null || p.heightMm == null) return null;
  const n = (v: number) => String(Math.round(v * 10) / 10);
  return { dims: `${n(p.widthMm)} × ${n(p.heightMm)}`, unit: lang === 'ar' ? 'مم' : 'mm' };
}

/** "38 × 45 mm" — the size as one line of text (link previews, tests). */
export function sizeLine(p: Pick<HostedProduct, 'widthMm' | 'heightMm'>, lang: 'ar' | 'en'): string | null {
  const parts = sizeParts(p, lang);
  return parts && `${parts.dims} ${parts.unit}`;
}

// ── The AR path: the widget's `ar.ts`, copied (this site does not import the platform). ─────────────

export type Device = { ios: boolean; quickLook: boolean; android: boolean };
export type ArPath = { kind: 'quick-look'; href: string } | { kind: 'scene-viewer'; href: string } | { kind: 'viewer' };

export function detectDevice(userAgent: string, maxTouchPoints: number, anchorSupportsAr: boolean): Device {
  const ua = userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const android = /Android/.test(ua) && !ios;
  return { ios, quickLook: ios && anchorSupportsAr, android };
}

type ArInput = { model: HostedModel; placement: Placement; name: string };

/** iPhone with a USDZ → Quick Look; Android with a plain GLB → Scene Viewer; anything else → the viewer. */
export function arPath(device: Device, p: ArInput, pageUrl: string): ArPath {
  const tryOn = p.placement === 'face' || p.placement === 'wrist';
  if (!tryOn && device.quickLook && p.model.usdz) return { kind: 'quick-look', href: `${p.model.usdz}#allowsContentScaling=0` };
  const plain = p.model.glbNative;
  if (!tryOn && device.android && plain) return { kind: 'scene-viewer', href: sceneViewerIntent(plain, p, pageUrl) };
  return { kind: 'viewer' };
}

export function sceneViewerIntent(file: string, p: Pick<ArInput, 'placement' | 'name'>, pageUrl: string): string {
  const params = new URLSearchParams({ file, mode: 'ar_preferred', resizable: 'false', title: p.name });
  if (p.placement === 'wall') params.set('enable_vertical_placement', 'true');
  const fallback = encodeURIComponent(pageUrl);
  return `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}`
    + `#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end;`;
}
