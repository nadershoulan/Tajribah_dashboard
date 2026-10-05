/**
 * T85 — the try-on as a shopper sees it, for any product, inside the dashboard: what the shop's
 * frame would get (`tryOnProductFrom` reads it), built from the product's draft settings — nothing
 * needs to be published or switched on.
 *
 *  - **What to try it as**: the merchant's choice on the preview (`as`), else the product's own kind
 *    (its type, and for Jewelry what it was marked as), else a guess from its category and name (the
 *    feed's own words: "خواتم" → a ring), said as a guess. Any product may be tried as any kind: a feed
 *    calls many things "other".
 *  - **The picture**: the product's own cut-out when it has one for that kind; else its store pictures
 *    as they are (`picture: 'store'`) — the screen says their background shows until a cut-out is added.
 *  - **The size**: the try-on settings' width; else the product's width when it fits the kind; else the
 *    example product's measured width (`size.from: 'example'`) — the screen says so, never as the real one.
 *  - **On me**: as the plan allows, as published.
 */
import { eq } from 'drizzle-orm';
import { categories, products, tryonConfigs } from '@/db/schema';
import { jewelryKindOf, typeFromCategory } from '@/lib/product-feed';
import { WIDTH_MM, kindOf, type TryOnKind } from '@/lib/tryon';
import type { TryOnPreview } from '@/lib/view-models';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import { forTenant } from '@/server/core/storage/storage';
import type { TenantContext } from '@/server/core/tenancy/context';
import { DEMO_BAG, DEMO_EARRING, DEMO_GLASSES, DEMO_NECKLACE, DEMO_RING, DEMO_WATCH } from '@site/lib/demo-product';

/** The demo's measured widths: the example a product without a size is shown at. */
export const EXAMPLE_MM: Record<TryOnKind, number> = {
  watch: DEMO_WATCH.caseMm, glasses: DEMO_GLASSES.caseMm, ring: DEMO_RING.caseMm,
  necklace: DEMO_NECKLACE.caseMm, earring: DEMO_EARRING.caseMm, bag: DEMO_BAG.caseMm,
};

/** A kind from words: the category first, then the name (Arabic and English); null when nothing says. */
export function guessKind(texts: (string | null | undefined)[]): TryOnKind | null {
  for (const text of texts) {
    if (!text) continue;
    const type = typeFromCategory(text);
    const kind = type === 'jewelry' ? jewelryKindOf(text) : type ? kindOf(type) : null;
    if (kind) return kind;
  }
  return null;
}

const fits = (kind: TryOnKind, mm: number | null | undefined): mm is number =>
  typeof mm === 'number' && Number.isFinite(mm) && mm >= WIDTH_MM[kind].min && mm <= WIDTH_MM[kind].max;

/** API-189 — the preview's settings for one product, tried as `as` (or as what it is). */
export async function tryOnPreview(ctx: TenantContext, productId: string, as: TryOnKind | null): Promise<TryOnPreview> {
  ctx.require('products:read');
  const product = await ctx.db.findById(products, productId);
  if (!product || product.deletedAt) throw errors.notFound('product');
  const tryon = await ctx.db.findOne(tryonConfigs, eq(tryonConfigs.productId, productId));
  const own = kindOf(product.productType, tryon?.category);
  const category = !as && !own && product.categoryId ? await ctx.db.findById(categories, product.categoryId) : null;
  const guess = as || own ? null : guessKind([category?.name, product.nameAr, product.name]);
  const kind = as ?? own ?? guess;
  const guessed = !as && !own && guess !== null;
  const onMe = (await entitlementsOf(ctx)).has('virtual_tryon');
  const store = (product.images ?? []).map((i) => i.url).filter((url) => /^https:\/\//.test(url));
  if (!kind) return { kind: null, own, guessed, picture: null, size: null, config: null, onMe };

  // The settings belong to the kind they were made for: a watch's cut-out is not a ring's.
  const mine = own === kind ? tryon : null;
  const files = forTenant(ctx.tenantId);
  const flatKey = kind === 'watch' ? mine?.flatKey : mine?.wornKey;
  const cutout = mine?.wornKey && flatKey ? { worn: files.publicUrl(mine.wornKey), flat: files.publicUrl(flatKey) } : null;
  const picture = cutout ? 'cutout' as const : store.length ? 'store' as const : null;
  const worn = cutout?.worn ?? store[0];
  const flat = cutout?.flat ?? store[0];

  const settings = mine?.caseTenthsMm != null ? mine.caseTenthsMm / 10 : null;
  const width = (product.dimensions as { widthMm?: number } | null)?.widthMm;
  const size = fits(kind, settings) ? { mm: settings, from: 'settings' as const }
    : fits(kind, width) ? { mm: width, from: 'product' as const }
      : { mm: EXAMPLE_MM[kind], from: 'example' as const };

  const config = worn && flat ? {
    v: 1 as const,
    product: { name: product.name.slice(0, 200), nameAr: product.nameAr?.slice(0, 200) || null },
    tryon: {
      ...(kind !== 'watch' ? { category: kind } : {}),
      worn, flat, caseMm: size.mm,
      sku: product.sku && product.sku.length <= 64 ? product.sku : null,
      onMe,
      finish: mine?.finishAr && mine.finishEn ? { ar: mine.finishAr, en: mine.finishEn } : null,
    },
  } : null;
  return { kind, own, guessed, picture, size, config, onMe };
}
