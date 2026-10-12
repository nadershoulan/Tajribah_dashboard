/**
 * T134.3 — what the phone page needs to be the try-on itself: the product (its picture as worn, its real size, what
 * kind it is), and the store it belongs to — so the shopper who scans the code stays in that store, with the product on
 * their own hand, and nothing that says they left.
 *
 * Read like the brand (T61), never taken from the request: a store's product from Tajribah's config host (the frame's
 * or the product page's own store and product), a demo product from the site's own list by its SKU. The only thing the
 * studio may say for itself is its kind, which only chooses the camera guide. So a forged pairing can show nothing but
 * a real product as its store published it.
 */
import type { Bi } from './lang';
import { brandFrom, tryOnProductFrom, type StoreBrand } from './tryon-config';
import { DEMO_BAG, DEMO_EARRING, DEMO_GLASSES, DEMO_NECKLACE, DEMO_RING, DEMO_WATCH, type TryOnProduct } from './demo-product';

export type PairKind = 'watch' | 'ring' | 'bag' | 'glasses' | 'necklace' | 'earring';
export const PAIR_KINDS: readonly PairKind[] = ['watch', 'ring', 'bag', 'glasses', 'necklace', 'earring'];

/** The product on the phone: its name, picture as worn, real width in millimetres and kind. */
export type PairProduct = { name: Bi; worn: string; caseMm: number; kind: PairKind };

/** What a pairing records for the phone page. `brand`: the store's name (and logo under white-label) — never Tajribah's. */
export type Pairing = { brand: StoreBrand | null; product: PairProduct | null; kind: PairKind; /** T137: where others can try it (shared with a picture). */ link?: string | null; /** T140.5: the store and product the anonymous counts are for */ track?: { store: string; product: string } | null };

/** The studio's category as the phone page's kind (left out: a watch). */
export function kindOf(product: Pick<TryOnProduct, 'category'>): PairKind {
  switch (product.category) {
    case 'eyewear': return 'glasses';
    case 'ring': case 'bag': case 'necklace': case 'earring': return product.category;
    default: return 'watch';
  }
}

export const pairProductOf = (p: TryOnProduct): PairProduct => ({ name: p.name, worn: p.worn, caseMm: p.caseMm, kind: kindOf(p) });

/** The site's demo products, by SKU. The watch is Failet's (the demo store); the others are generic examples. */
const DEMOS: readonly TryOnProduct[] = [DEMO_WATCH, DEMO_GLASSES, DEMO_RING, DEMO_NECKLACE, DEMO_BAG, DEMO_EARRING];
const FAILET: StoreBrand = { name: { ar: 'فايلت', en: 'Failet' }, logo: null };

export function demoPairing(sku: unknown): Pairing | null {
  const found = typeof sku === 'string' ? DEMOS.find((d) => d.sku === sku) : undefined;
  if (!found) return null;
  return { brand: found === DEMO_WATCH ? FAILET : null, product: pairProductOf(found), kind: kindOf(found) };
}

/**
 * From a published config: the product, and the store — its white-label brand (Enterprise: name and logo), else its
 * name from the product page block (every plan publishes it unless the merchant switched the page off).
 */
export function pairingFromConfig(config: unknown, local = false): Pairing | null {
  const product = tryOnProductFrom(config, local);
  const brand = brandFrom(config, local) ?? storeNameOf(config);
  if (!product) return brand ? { brand, product: null, kind: 'watch' } : null;
  return { brand, product: pairProductOf(product), kind: kindOf(product) };
}

function storeNameOf(config: unknown): StoreBrand | null {
  const page = (config as { page?: { store?: { name?: unknown; nameAr?: unknown } } } | null)?.page;
  const name = page?.store?.name, nameAr = page?.store?.nameAr;
  const ok = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 80;
  if (!ok(name) || !(nameAr == null || ok(nameAr))) return null;
  return { name: { ar: nameAr ?? name, en: name }, logo: null };
}

/** The studio's request body: a kind (the guide only) and, on the demo, the product's SKU. Anything else is ignored. */
export function pairRequestOf(body: string): { kind: PairKind | null; demo: string | null } {
  if (!body || body.length > 1024) return { kind: null, demo: null };
  try {
    const parsed = JSON.parse(body) as { kind?: unknown; demo?: unknown };
    const kind = PAIR_KINDS.includes(parsed.kind as PairKind) ? (parsed.kind as PairKind) : null;
    const demo = typeof parsed.demo === 'string' && parsed.demo.length <= 64 ? parsed.demo : null;
    return { kind, demo };
  } catch { return { kind: null, demo: null }; }
}

/** A session read back from storage, checked again (it was written by us, but a bad one must not break the page). */
export function pairingOfSession(session: { brand?: unknown; product?: unknown; kind?: unknown; link?: unknown; track?: unknown } | null): Pairing {
  const kind = PAIR_KINDS.includes(session?.kind as PairKind) ? (session!.kind as PairKind) : 'watch';
  const brand = session?.brand && typeof session.brand === 'object' ? (session.brand as StoreBrand) : null;
  const p = session?.product as Partial<PairProduct> | null | undefined;
  const product = p && typeof p.worn === 'string' && /^(https?:\/\/|\/assets\/)/.test(p.worn) && typeof p.caseMm === 'number' && p.caseMm > 0 && p.name && typeof p.name.ar === 'string' && typeof p.name.en === 'string' && PAIR_KINDS.includes(p.kind as PairKind)
    ? { name: p.name, worn: p.worn, caseMm: p.caseMm, kind: p.kind as PairKind }
    : null;
  const link = typeof session?.link === 'string' && /^https?:\/\/[^\s]{1,600}$/.test(session.link) ? session.link : null;
  const t = session?.track as { store?: unknown; product?: unknown } | null | undefined;
  const track = t && typeof t.store === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(t.store) && typeof t.product === 'string' && t.product.length > 0 && t.product.length <= 200 ? { store: t.store, product: t.product } : null;
  return { brand, product, kind: product?.kind ?? kind, link, track };
}
