/**
 * Recommendations, first version — the product page's read.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { json, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { relatedOf } from './service';

/** API-138 — GET /api/products/[id]/related: products often viewed together with this one. */
export const relatedHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 2] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('product');
  return json(await relatedOf(ctx, id));
});
