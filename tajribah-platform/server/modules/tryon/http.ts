/**
 * P5.10 — try-on settings endpoints (the owner's studio, T26).
 */
import { z } from 'zod';
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json, readJson, tenantContextFor } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { calibrateCutoutEdges, confirmCutout, cutoutFile, startCutoutUpload, tryOnScreen, updateTryOn } from './service';

/** The `[productId]` segment `fromEnd` places from the end; a malformed id is a 404. */
function productAt(request: Request, fromEnd: number): string {
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 1 - fromEnd] ?? '';
  if (!z.string().uuid().safeParse(id).success) throw errors.notFound('product');
  return id;
}
const SLOT = z.enum(['worn', 'flat']);

/** API-150 — GET /api/tryon: every watch with its try-on settings, and whether the plan has try-on. */
export const tryOnScreenHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  return json(await tryOnScreen(ctx));
});

/** API-151 — POST /api/tryon/[productId]/images: a presigned PUT for the worn or flat picture. */
export const startCutoutHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.object({ slot: SLOT, filename: z.string().trim().min(1).max(200), contentType: z.string().max(100), sizeBytes: z.number().int() }));
  return json(await startCutoutUpload(ctx, productAt(request, 1), body), { status: 201 });
});

/** API-152 — POST /api/tryon/[productId]/images/confirm: check the picture that arrived. */
export const confirmCutoutHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  return json(await confirmCutout(ctx, productAt(request, 2), await readJson(request, z.object({ slot: SLOT, key: z.string().max(300) }))));
});

/** API-153 — PATCH /api/tryon/[productId]: case width, finish, on/off. */
export const updateTryOnHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.object({
    caseMm: z.number().nullable().optional(), finishAr: z.string().max(200).nullable().optional(),
    finishEn: z.string().max(200).nullable().optional(), enabled: z.boolean().optional(),
  }));
  return json(await updateTryOn(ctx, productAt(request, 0), body));
});

/** API-154 — GET /api/tryon/[productId]/images/[slot]: the stored picture, for the screen's preview. */
export const cutoutFileHandler = route(async (request) => {
  const ctx = await tenantContextFor(request);
  const slot = SLOT.safeParse(new URL(request.url).pathname.split('/').filter(Boolean).pop());
  if (!slot.success) throw errors.notFound('picture');
  const file = await cutoutFile(ctx, productAt(request, 2), slot.data);
  return new Response(file.body, { headers: { 'content-type': file.contentType, 'cache-control': 'private, no-store' } });
});

/** API-178 — POST /api/tryon/[productId]/images/calibrate { slot, key, left, right }: crop to the case's edges (T68). */
export const calibrateCutoutHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const ctx = await tenantContextFor(request, config);
  const body = await readJson(request, z.object({ slot: SLOT, key: z.string().max(300), left: z.number().int(), right: z.number().int() }));
  return json(await calibrateCutoutEdges(ctx, productAt(request, 2), body));
});
