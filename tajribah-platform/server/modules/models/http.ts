/**
 * P1.12 — model upload endpoints.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { listModels, publishVersion } from './library';
import { confirmUpload, modelVersionsOf, startUpload } from './service';

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

/** The `[id]` segment `fromEnd` places from the end; a malformed id is a 404. */
function idAt(request: Request, fromEnd: number, what: string): string {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1 - fromEnd] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound(what);
  return id;
}

/** API-052 — GET /api/models */
export const listModelsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ models: await listModels(ctx) });
});

/** API-053 — GET /api/models/[id]/versions */
export const modelVersionsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json({ versions: await modelVersionsOf(ctx, idAt(request, 1, 'model')) });
});

/** API-054 — POST /api/models/versions/[id]/publish → that version is live */
export const publishVersionHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  await publishVersion(ctx, idAt(request, 1, 'model version'));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});
