/**
 * P1.8 — the products API contract, shared by the handlers (validation) and the dashboard
 * (types). The response shape is `ProductRow` in lib/view-models.ts, which the screens were
 * built against before the API existed.
 */
import { z } from 'zod';
import type { ProductRow } from '../view-models';

/** Millimetres, as the merchant measures them. 3 m covers furniture; anything larger is a typo. */
const MM = z.number().positive('must be more than 0').max(3000, 'is over 3 metres — check the unit (mm)');

export const Dimensions = z.object({
  widthMm: MM.optional(),
  heightMm: MM.optional(),
  depthMm: MM.optional(),
  caseMm: MM.optional(),
}).strict();

const PRODUCT_TYPE = z.enum(['jewelry', 'watch', 'eyewear', 'bag', 'apparel', 'furniture', 'other']);

export const ProductCreate = z.object({
  name: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().max(200).optional(),
  sku: z.string().trim().max(100).optional(),
  priceMinor: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).default('SAR'),
  productType: PRODUCT_TYPE.default('other'),
  dimensions: Dimensions.optional(),
  status: z.enum(['active', 'draft']).default('active'),
}).strict();
export type ProductCreate = z.infer<typeof ProductCreate>;

/**
 * What a merchant may change. For a product synced from their store, only the fields the
 * store does not own (dimensions, type, AR/try-on switches) — anything else would be
 * overwritten by the next sync, silently.
 */
export const ProductPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  nameAr: z.string().trim().max(200).nullable().optional(),
  sku: z.string().trim().max(100).nullable().optional(),
  priceMinor: z.number().int().nonnegative().nullable().optional(),
  productType: PRODUCT_TYPE.optional(),
  dimensions: Dimensions.nullable().optional(),
  arEnabled: z.boolean().optional(),
  tryonEnabled: z.boolean().optional(),
  status: z.enum(['active', 'draft']).optional(),
}).strict();
export type ProductPatch = z.infer<typeof ProductPatch>;

/** Fields a store connection owns; refused in a patch to a synced product. */
export const STORE_OWNED_FIELDS = ['name', 'nameAr', 'sku', 'priceMinor'] as const;

export const PRODUCT_FILTERS = ['all', 'ar_on', 'no_ar', 'missing_sizes', 'draft'] as const;
export type ProductFilter = (typeof PRODUCT_FILTERS)[number];

export const ProductListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(PRODUCT_FILTERS).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** The last id of the previous page (uuid v7 — time-ordered). */
  cursor: z.string().uuid().optional(),
});
export type ProductListQuery = z.infer<typeof ProductListQuery>;

/** One page of the catalogue, as `GET /api/products` returns it. Counts honour the search. */
export type ProductListPage = {
  rows: ProductRow[];
  counts: Record<ProductFilter, number>;
  nextCursor: string | null;
};
