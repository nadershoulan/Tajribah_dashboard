/**
 * P1.12 — model upload endpoints.
 */
import { z } from 'zod';
import { editModel, modelFileFor } from './edit';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { deleteModel, deleteVersion, listModels, publishVersion } from './library';
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

const TURN = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const MODEL_EDIT = z.object({
  fromVersionId: z.string().uuid(),
  rotate: z.object({ x: TURN.optional(), y: TURN.optional(), z: TURN.optional() }).optional(),
  fit: z.boolean().optional(),
});

/** API-055 — GET /api/models/versions/[id]/file: the version's web GLB, for the editor's viewer (P3.8). */
export const modelFileHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  const file = await modelFileFor(ctx, idAt(request, 1, 'model version'));
  return new Response(file.body, { headers: { 'content-type': 'model/gltf-binary', 'content-length': String(file.size), 'cache-control': 'private, no-store' } });
});

/** API-056 — POST /api/models/[id]/edit: turn and/or fit a ready version into the next one (P3.8). */
export const editModelHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  return json(await editModel(ctx, idAt(request, 1, 'model'), await readJson(request, MODEL_EDIT)), { status: 201 });
});

/** API-057 — DELETE /api/models/versions/[id] (T46): a version that is not live. */
export const deleteVersionHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  await deleteVersion(ctx, idAt(request, 0, 'model version'));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});

/** API-058 — DELETE /api/models/[id] (T46): the whole model, off the shop too. */
export const deleteModelHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  await deleteModel(ctx, idAt(request, 0, 'model'));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});
