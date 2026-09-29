/**
 * P1.8 — the products domain.
 *
 * Reads through `ctx.db` (tenant-scoped); every change through the audited helpers. Three
 * rules that are about the product, not the plumbing:
 *
 *  1. **AR needs a real size.** Switching AR on without width and height in millimetres is
 *     refused — a 3D watch at the wrong scale is worse than no 3D watch.
 *  2. **The store owns what it syncs.** A product that came from a store connection keeps
 *     its name, SKU and price from the store; editing them here would be overwritten by
 *     the next sync, silently. Only the fields the store does not have are editable.
 *  3. **Deleting is soft.** The row stays (orders and analytics still point at it), hidden.
 */
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { dailyProductStats, edgeConfigs, models3d, products, type Product } from '@/db/schema';
import {
  ProductCreate, ProductPatch, STORE_OWNED_FIELDS,
  type ProductFilter, type ProductListPage, type ProductListQuery,
} from '@/lib/contracts/products';
import { riyadhDay } from '@/lib/format';
import type { ProductRow } from '@/lib/view-models';
import { auditedInsert, auditedUpdate } from '@/server/core/audit/audit';
import { assertWithinQuota } from '@/server/core/billing/entitlements';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import { keepLive } from '@/server/modules/edge/publish';
import { emitEvent } from '@/server/modules/outgoing-webhooks/emit';
import { productV1 } from '@/server/modules/public-api/v1';
import type { TenantContext } from '@/server/core/tenancy/context';

const SIZED = and(
  sql`(${products.dimensions}->>'widthMm') is not null`,
  sql`(${products.dimensions}->>'heightMm') is not null`,
)!;

const FILTER: Record<ProductFilter, SQL> = {
  all: ne(products.status, 'archived'),
  ar_on: and(ne(products.status, 'archived'), eq(products.arEnabled, true))!,
  no_ar: and(ne(products.status, 'archived'), eq(products.arEnabled, false))!,
  missing_sizes: and(ne(products.status, 'archived'), sql`not (${SIZED})`)!,
  draft: eq(products.status, 'draft'),
};

/** `%` and `_` in a search box are characters, not wildcards. */
const likeEscape = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export type ProductList = ProductListPage;

export async function listProducts(ctx: TenantContext, query: ProductListQuery): Promise<ProductList> {
  ctx.require('products:read');
  const live = isNull(products.deletedAt);
  const search = query.q
    ? or(ilike(products.name, likeEscape(query.q)), ilike(products.nameAr, likeEscape(query.q)), ilike(products.sku, likeEscape(query.q)))
    : undefined;
  // Keyset paging on the id: uuid v7 is time-ordered and never changes, unlike updated_at.
  const after = query.cursor ? lt(products.id, query.cursor) : undefined;

  const page = await ctx.db.find(products, and(live, FILTER[query.filter], search, after), {
    limit: query.limit + 1, orderBy: desc(products.id),
  });
  const more = page.length > query.limit;
  const rows = more ? page.slice(0, query.limit) : page;

  const counts = Object.fromEntries(await Promise.all(
    (Object.keys(FILTER) as ProductFilter[]).map(async (key) => [key, await ctx.db.count(products, and(live, FILTER[key], search))] as const),
  )) as Record<ProductFilter, number>;

  return { rows: await toRows(ctx, rows), counts, nextCursor: more ? rows[rows.length - 1].id : null };
}

export async function getProduct(ctx: TenantContext, id: string): Promise<ProductRow> {
  ctx.require('products:read');
  const product = await ctx.db.findOne(products, and(eq(products.id, id), isNull(products.deletedAt)));
  if (!product) throw errors.notFound('product');
  return (await toRows(ctx, [product]))[0];
}

export async function createProduct(ctx: TenantContext, input: unknown): Promise<ProductRow> {
  ctx.require('products:write');
  const data = parse(ProductCreate, input);
  await assertWithinQuota(ctx, 'products');
  const created = await auditedInsert(ctx, products, { ...data, dimensions: data.dimensions ?? null }, { resourceType: 'product' });
  const row = await getProduct(ctx, String(created.id));
  await emitEvent(ctx, 'product.created', productV1(row)); // P8
  return row;
}

export async function updateProduct(ctx: TenantContext, id: string, input: unknown): Promise<ProductRow> {
  ctx.require('products:write');
  const patch = parse(ProductPatch, input);
  const current = await ctx.db.findOne(products, and(eq(products.id, id), isNull(products.deletedAt)));
  if (!current) throw errors.notFound('product');

  if (current.connectionId) {
    const owned = STORE_OWNED_FIELDS.filter((field) => field in patch);
    if (owned.length) {
      throw errors.validation(Object.fromEntries(owned.map((f) => [f, ['comes from your store — change it there, it syncs here']])));
    }
  }

  const dimensions = patch.dimensions === undefined ? current.dimensions : patch.dimensions;
  const arOn = patch.arEnabled ?? current.arEnabled;
  if (arOn && !(dimensions?.widthMm && dimensions?.heightMm)) {
    throw errors.validation({ arEnabled: ['needs the width and height in millimetres first — AR shows the real size'] });
  }

  await auditedUpdate(ctx, products, id, patch as Record<string, unknown>, { resourceType: 'product' });
  await keepLive(ctx.tenantId, id); // P1.15: name, sizes and AR on/off are in the published config
  const row = await getProduct(ctx, id);
  await emitEvent(ctx, 'product.updated', productV1(row)); // P8
  return row;
}

export async function deleteProduct(ctx: TenantContext, id: string): Promise<void> {
  ctx.require('products:delete');
  const current = await ctx.db.findOne(products, and(eq(products.id, id), isNull(products.deletedAt)));
  if (!current) throw errors.notFound('product');
  await auditedUpdate(ctx, products, id, { deletedAt: new Date(), status: 'archived', arEnabled: false },
    { resourceType: 'product', action: 'delete' });
  await keepLive(ctx.tenantId, id); // P1.15: a deleted product's button goes too
  await emitEvent(ctx, 'product.deleted', { id }); // P8
}

// ------------------------------------------------------------------ view mapping

function parse<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { path: readonly (string | number)[]; message: string }[] } } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw errors.validation(fieldErrorsFrom(result.error.issues));
  return result.data;
}

const MODEL_STATUS: Record<string, ProductRow['modelStatus']> = {
  processing: 'processing', ready: 'ready', failed: 'failed',
};

/** Product rows plus what the list shows beside them: model status and the last 30 days. */
async function toRows(ctx: TenantContext, list: Product[]): Promise<ProductRow[]> {
  if (list.length === 0) return [];
  const ids = list.map((p) => p.id);
  const modelIds = list.map((p) => p.primaryModelId).filter((id): id is string => !!id);
  const since = riyadhDay(Date.now() - 29 * 24 * 3600_000);

  const [models, stats, live] = await Promise.all([
    modelIds.length ? ctx.db.find(models3d, inArray(models3d.id, modelIds), { limit: modelIds.length }) : Promise.resolve([]),
    ctx.db.find(dailyProductStats, and(inArray(dailyProductStats.productId, ids), gte(dailyProductStats.day, since)), { limit: ids.length * 30 }),
    // T42: which of these have a button on the shop now.
    ctx.db.find(edgeConfigs, and(inArray(edgeConfigs.productId, ids), isNotNull(edgeConfigs.key), isNull(edgeConfigs.withdrawnAt)), { limit: ids.length }),
  ]);
  const liveIds = new Set(live.map((row) => row.productId));
  const modelStatus = new Map(models.map((m) => [m.id, MODEL_STATUS[m.status] ?? 'none']));
  const totals = new Map<string, { views: number; ar: number }>();
  for (const row of stats) {
    const t = totals.get(row.productId) ?? { views: 0, ar: 0 };
    t.views += row.views;
    t.ar += row.arSessions;
    totals.set(row.productId, t);
  }

  return list.map((p) => ({
    id: p.id,
    name: p.name,
    nameAr: p.nameAr,
    sku: p.sku,
    imageUrl: p.images?.[0]?.url ?? null,
    priceMinor: p.priceMinor,
    currency: p.currency,
    productType: p.productType,
    status: p.status,
    arEnabled: p.arEnabled,
    tryonEnabled: p.tryonEnabled,
    live: liveIds.has(p.id),
    modelStatus: p.primaryModelId ? modelStatus.get(p.primaryModelId) ?? 'none' : 'none',
    dimensions: p.dimensions,
    views30: totals.get(p.id)?.views ?? 0,
    arSessions30: totals.get(p.id)?.ar ?? 0,
    updatedAt: p.updatedAt.toISOString(),
  }));
}
