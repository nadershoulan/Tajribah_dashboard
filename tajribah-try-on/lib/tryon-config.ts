/**
 * P5 (T26) — a merchant's published try-on config, read by the embed page on the server (P5.12)
 * and, when that could not answer, in the browser. One parser for both, so the two can never
 * accept different things.
 *
 * The product comes from Tajribah's own config host, by store key and product reference — never
 * from the page's address — so the page can only ever show what a merchant published. It is
 * checked as strictly as the widget checks it: https images only, a case width a watch can have.
 * A test on this machine may point at a local config and local pictures; a public page never can.
 */
import type { Bi } from './lang';
import { MODELS, type TryOnProduct } from './demo-product';

/** Where published configs live (the same host the storefront widget reads). */
export const CONFIG_BASE = 'https://cfg.tajribah.com/v1';
/** What the frame tells the page it sits on. The widget listens only to our origin. */
export const CLOSE_MESSAGE = 'tajribah:tryon:close';

const LOCAL = ['localhost', '127.0.0.1'];
export const isLocalHost = (hostname: string) => LOCAL.includes(hostname);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
/** https only — except a page on this machine may use a local http server (a public page never is local). */
const httpsUrl = (v: unknown, local: boolean): v is string => {
  if (!str(v, 2048)) return false;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' || (local && url.protocol === 'http:' && isLocalHost(url.hostname));
  } catch { return false; }
};

/** Could these name a published config at all? Anything else is not looked up. */
export function validRefs(store: string, product: string): boolean {
  return /^[a-z0-9-]{1,64}$/i.test(store) && product.length > 0 && product.length <= 200;
}

/** The config host to read: ours, or — only on this machine — a local test server. */
export function configBase(requested: string | null | undefined, local: boolean): string {
  if (!local || !requested) return CONFIG_BASE;
  try { return isLocalHost(new URL(requested).hostname) ? requested : CONFIG_BASE; } catch { return CONFIG_BASE; }
}

export function configUrl(base: string, store: string, product: string): string {
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(store)}/${encodeURIComponent(product)}.json`;
}

/** The studio's product from a published config, or null when anything about it is wrong. */
export function tryOnProductFrom(config: unknown, local = false): TryOnProduct | null {
  if (!isObj(config) || config.v !== 1 || !isObj(config.product) || !isObj(config.tryon)) return null;
  const { product, tryon } = config;
  if (!str(product.name) || !(product.nameAr == null || str(product.nameAr))) return null;
  if (!httpsUrl(tryon.worn, local) || !httpsUrl(tryon.flat, local)) return null;
  // P5.2 (T68): `category: 'glasses'` — a frame's width (100–170 mm); absent — a watch's case (5–80 mm), as the widget reads it.
  const glasses = tryon.category === 'glasses';
  if (tryon.category !== undefined && !glasses) return null;
  const [lo, hi] = glasses ? [100, 170] : [5, 80];
  if (typeof tryon.caseMm !== 'number' || !Number.isFinite(tryon.caseMm) || tryon.caseMm < lo || tryon.caseMm > hi) return null;
  if (!(tryon.sku == null || str(tryon.sku, 64))) return null;
  const name: Bi = { ar: (product.nameAr as string | null) ?? product.name, en: product.name };
  return {
    sku: (tryon.sku as string | null | undefined) ?? '—',
    collection: { ar: 'تجربة افتراضية', en: 'Virtual try-on' },
    headLead: { ar: 'جرّبها', en: 'Try it' },
    headEm: { ar: 'قبل أن تشتري.', en: 'before you buy.' },
    name,
    finish: isObj(tryon.finish) && str(tryon.finish.ar, 80) && str(tryon.finish.en, 80)
      ? { ar: tryon.finish.ar, en: tryon.finish.en }
      : { ar: 'بمقاسها الحقيقي', en: 'At its real size' },
    caseMm: tryon.caseMm,
    worn: tryon.worn,
    flat: tryon.flat,
    storeUrl: '',
    alt: name,
    storeLink: null, // the shopper is already on the store's page
    demo: false,
    // T33: the shopper's own photo — Pro and up; glasses not yet (finding a face is not built)
    onMe: !glasses && tryon.onMe === true,
    ...(glasses ? { category: 'eyewear' as const } : {}),
  };
}

/** T61 — white-label (Enterprise): the store's own name and logo, shown where shoppers would see Tajribah's. */
export type StoreBrand = { name: Bi; logo: string | null };

/**
 * The store's brand from a published config, or null — no brand block (every plan but Enterprise)
 * or anything about it wrong. Then the pages show Tajribah's name, as before. The logo is optional
 * (https only); without one the store's name stands in its place.
 */
export function brandFrom(config: unknown, local = false): StoreBrand | null {
  if (!isObj(config) || !isObj(config.brand)) return null;
  const { brand } = config;
  if (!str(brand.name, 80) || !(brand.nameAr == null || str(brand.nameAr, 80))) return null;
  if (!(brand.logo == null || httpsUrl(brand.logo, local))) return null;
  return { name: { ar: (brand.nameAr as string | null | undefined) ?? brand.name, en: brand.name }, logo: (brand.logo as string | null | undefined) ?? null };
}

/** The try-on page's title: the store's own under white-label, Tajribah's otherwise. */
export const embedTitle = (brand: StoreBrand | null | undefined, lang: 'ar' | 'en') =>
  brand ? (lang === 'ar' ? `${brand.name.ar} · تجربة افتراضية` : `${brand.name.en} · Virtual try-on`) : 'Tajribah try-on';

/**
 * The pictures the studio's first view draws — the wrist photo and the watch as worn. The embed
 * page names them in its HTML so they download alongside the page's scripts, not after. The rest
 * (lifestyle photo, flat shot, reference objects) the studio fetches itself right after its first
 * draw (T31), so they are not named here: they would only compete with these two.
 */
export function studioImages(product: TryOnProduct): string[] {
  return [MODELS[0]!.src, product.worn];
}
