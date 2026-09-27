/**
 * P3.2 — AI job endpoints: the list and one job for progress, and cancelling. Creating a job
 * arrives with the screen that asks for one (P3.7): its input depends on the provider adapter.
 * P3.3 — product photos for generation: start an upload, confirm it, list, remove.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { aiJobView, cancelAiJob, listAiJobs } from './lifecycle';
import { confirmPhoto, listPhotos, removePhoto, startPhotoUpload } from './photos';

/** The `[id]` segment `fromEnd` places from the end; a malformed id is a 404. */
function idAt(request: Request, fromEnd: number, what = 'ai_job'): string {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1 - fromEnd] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound(what);
  return id;
}

/** API-140 — GET /api/ai-jobs?active=1&limit= */
export const listAiJobsHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get('limit') ?? 20);
  return json({ jobs: await listAiJobs(ctx, { active: params.get('active') === '1', limit: Number.isFinite(limit) ? limit : 20 }) });
});

/** API-141 — GET /api/ai-jobs/[id]: status, progress and stage, for a progress bar. */
export const aiJobHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await aiJobView(ctx, idAt(request, 0)));
});

/** API-142 — POST /api/ai-jobs/[id]/cancel: immediate, credits back; 409 if it already ended. */
export const cancelAiJobHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  return json(await cancelAiJob(ctx, idAt(request, 1)));
});

const StartPhoto = z.object({
  angle: z.enum(['front', 'side', 'back', 'detail']),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().max(100),
  sizeBytes: z.number().int(),
});

/** API-143 — POST /api/products/[id]/photos → a presigned URL for one photo */
export const startPhotoHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  return json(await startPhotoUpload(ctx, idAt(request, 1, 'product'), await readJson(request, StartPhoto)), { status: 201 });
});

/** API-144 — POST /api/products/[id]/photos/[photoId]/confirm → the verdict on what arrived */
export const confirmPhotoHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  return json(await confirmPhoto(ctx, idAt(request, 3, 'product'), idAt(request, 1, 'photo')));
});

/** API-145 — GET /api/products/[id]/photos → the photos, and whether a generation could start */
export const listPhotosHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await listPhotos(ctx, idAt(request, 1, 'product')));
});

/** API-146 — DELETE /api/products/[id]/photos/[photoId] */
export const removePhotoHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  await removePhoto(ctx, idAt(request, 2, 'product'), idAt(request, 0, 'photo'));
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
});
