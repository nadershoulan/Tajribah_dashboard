/**
 * T140.1 — the store's other try-on products, for "this one or that one" on the shopper's own photo. The publisher keeps
 * the store's shelf next to its configs (`server/modules/edge/shelf.ts`, ref `shelf:tryons`); the try-on page reads it
 * from the config host. Each entry is checked as a product config is (`tryOnProductFrom`: https pictures, a real size
 * in range for its kind), so a bad entry is simply left out.
 */
import { tryOnProductFrom } from './tryon-config';
import type { TryOnProduct } from './demo-product';

export const SHELF_REF = 'shelf:tryons';
/** How many other products are offered to compare with. */
export const COMPARE_MAX = 12;

export type Choice = { ref: string; product: TryOnProduct; page: string | null };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The shelf's products that check out, as the studio's products. */
export function shelfFrom(json: unknown, local = false): Choice[] {
  if (!isObj(json) || json.v !== 1 || !Array.isArray(json.products)) return [];
  return json.products.slice(0, 40).flatMap((e: unknown) => {
    if (!isObj(e) || typeof e.ref !== 'string' || !e.ref) return [];
    const category = typeof e.category === 'string' && e.category !== 'watch' ? { category: e.category } : {};
    const product = tryOnProductFrom({ v: 1, product: { name: e.name, nameAr: e.nameAr ?? null }, tryon: { worn: e.worn, flat: e.flat, caseMm: e.caseMm, ...category } }, local);
    if (!product) return [];
    return [{ ref: e.ref, product, page: typeof e.page === 'string' && /^https:\/\//.test(e.page) ? e.page : null }];
  });
}

/** What the shopper may put beside `current`: the same kind (a watch beside a watch), never the same product. */
export function compareChoices(shelf: Choice[], current: TryOnProduct, currentRef: string | null): Choice[] {
  const kind = (p: TryOnProduct) => p.category ?? 'watch';
  return shelf.filter((c) => kind(c.product) === kind(current) && c.ref !== currentRef && c.product.worn !== current.worn).slice(0, COMPARE_MAX);
}

/**
 * The second product's width on the photo: the first's as the shopper sized it, times their real sizes' ratio — a
 * 42 mm case is 42/38 of a 38 mm one on the same wrist.
 */
export const widthBeside = (firstWidth: number, firstMm: number, otherMm: number) => (firstMm > 0 ? firstWidth * (otherMm / firstMm) : firstWidth);

/** A square crop round where the products sit, the same for both halves: about three times the larger one, in the stage. */
export function cropRound(at: { x: number; y: number }, largest: number, stage: { W: number; H: number }): { x: number; y: number; side: number } {
  const side = Math.min(stage.W, stage.H, Math.max(260, largest * 3.2));
  return { x: Math.min(Math.max(at.x - side / 2, 0), stage.W - side), y: Math.min(Math.max(at.y - side / 2, 0), stage.H - side), side };
}
