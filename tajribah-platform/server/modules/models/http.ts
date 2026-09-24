/**
 * P1.12 — model upload endpoints.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { confirmUpload, startUpload } from './service';

const StartUpload = z.object({
  filename: z.string().min(1).max(200),
  sizeBytes: z.number().int(),
  productId: z.string().uuid().nullish(),
  modelId: z.string().uuid().nullish(),
});

/** API-050 — POST /api/models/uploads → a presigned URL for the bytes */
export const startUploadHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  return json(await startUpload(ctx, await readJson(request, StartUpload)), { status: 201 });
});

/** API-051 — POST /api/models/versions/[id]/confirm → check what arrived */
export const confirmUploadHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 2] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('model version');
  return json(await confirmUpload(ctx, id));
});
