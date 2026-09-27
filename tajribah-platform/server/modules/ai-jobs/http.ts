/**
 * P3.2 — AI job endpoints: the list and one job for progress, and cancelling. Creating a job
 * arrives with the screen that asks for one (P3.7): its input depends on the provider adapter.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { aiJobView, cancelAiJob, listAiJobs } from './lifecycle';

/** The `[id]` segment `fromEnd` places from the end; a malformed id is a 404. */
function idAt(request: Request, fromEnd: number): string {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1 - fromEnd] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('ai_job');
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
