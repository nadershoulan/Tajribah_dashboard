/**
 * Recommendations, first version — what the product page shows the merchant: the products shoppers
 * looked at together with this one in the last 30 days (`compute.ts`), most shared visits first. Every
 * plan sees it here; showing them to shoppers (the product's own page) is Pro and up.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { productRelations, products } from '@/db/schema';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';

export type RelatedView = {
  related: { productId: string; name: string; nameAr: string | null; sessions: number }[];
  /** Whether the store's plan shows them to shoppers (`recommendations`, Pro and up). */
  shownToShoppers: boolean;
  computedAt: string | null;
};

/** API-138 — this product's often-viewed-together products. */
export async function relatedOf(ctx: TenantContext, productId: string): Promise<RelatedView> {
  ctx.require('products:read');
  const product = await ctx.db.findById(products, productId);
  if (!product || product.deletedAt) throw errors.notFound('product');
  const rows = await ctx.db.find(productRelations, eq(productRelations.productId, productId), { orderBy: asc(productRelations.rank), limit: 10 });
  const named = rows.length ? await ctx.db.find(products, inArray(products.id, rows.map((r) => r.relatedProductId)), { limit: rows.length }) : [];
  return {
    related: rows.flatMap((r) => {
      const p = named.find((n) => n.id === r.relatedProductId && !n.deletedAt);
      return p ? [{ productId: p.id, name: p.name, nameAr: p.nameAr, sessions: r.sessions }] : [];
    }),
    shownToShoppers: (await entitlementsOf(ctx)).has('recommendations'),
    computedAt: rows[0]?.computedAt.toISOString() ?? null,
  };
}
