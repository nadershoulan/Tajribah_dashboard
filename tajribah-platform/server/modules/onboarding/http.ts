/**
 * P1.1 — onboarding endpoints. Same shape as the auth handlers: plain
 * `(Request) => Response`, wrapped in `route()`, one-line route files in `app/api/**`.
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { STEPS } from './machine';
import { confirmStoreStep, onboardingOf, skipStep, unskipStep } from './service';

const STEP = z.object({ step: z.enum(STEPS) });

/** API-020 — GET /api/onboarding: the checklist, evaluated from the database. */
export const getOnboardingHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await onboardingOf(ctx));
});

/** API-021 — POST /api/onboarding/skip */
export const skipStepHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const { step } = await readJson(request, STEP);
  return json(await skipStep(ctx, step));
});

/** API-022 — POST /api/onboarding/unskip */
export const unskipStepHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const { step } = await readJson(request, STEP);
  return json(await unskipStep(ctx, step));
});

/** API-023 — POST /api/onboarding/confirm-store. Body optional: `{ slug }` to choose the store's address first. */
export const confirmStoreHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const hasBody = (request.headers.get('content-type') ?? '').includes('application/json');
  const body = hasBody ? await readJson(request, z.object({ slug: z.string().trim().toLowerCase().max(60).optional() }).strict()) : {};
  return json(await confirmStoreStep(ctx, body));
});
