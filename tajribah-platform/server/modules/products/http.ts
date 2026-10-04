/**
 * P1.8 — product endpoints. `(Request) => Response` handlers, one-line route files.
 */
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import { ProductListQuery } from '@/lib/contracts/products';
import { z } from 'zod';
import { createProduct, deleteProduct, getProduct, listProductCategories, listProducts, updateProduct } from './service';

const UUID = z.string().uuid();

/** The `[id]` segment. A malformed id is a 404 — the same answer as an id that does not exist. */
function idFrom(request: Request): string {
  const id = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!UUID.safeParse(id).success) throw errors.notFound('product');
  return id;
}

/** API-030 — GET /api/products?q=&filter=&limit=&cursor= */
export const listProductsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  const parsed = ProductListQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) throw errors.validation(fieldErrorsFrom(parsed.error.issues));
  return json(await listProducts(ctx, parsed.data));
});

/** API-186 — GET /api/products/categories: the store's categories and how many products each has (T77). */
export const listProductCategoriesHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ categories: await listProductCategories(ctx) });
});

/** API-031 — POST /api/products (a product added by hand, not synced) */
export const createProductHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.unknown());
  return json(await createProduct(ctx, body), { status: 201 });
});

/** API-032 — GET /api/products/[id] */
export const getProductHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await getProduct(ctx, idFrom(request)));
});

/** API-033 — PATCH /api/products/[id] */
export const updateProductHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const id = idFrom(request);
  const body = await readJson(request, z.unknown());
  return json(await updateProduct(ctx, id, body));
});

/** API-034 — DELETE /api/products/[id] (soft) */
export const deleteProductHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  await deleteProduct(ctx, idFrom(request));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});
