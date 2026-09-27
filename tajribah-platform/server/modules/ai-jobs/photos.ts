/**
 * P3.3 — product photos for 3D generation: upload straight to storage, then a check of what
 * actually arrived, before any credits are spent.
 *
 *   start  → a row `uploading` and a presigned PUT (bytes never pass through us, as for models)
 *   confirm→ the bytes are read and judged (`photo-check.ts`): `accepted`, or `rejected` with its
 *            reasons and its bytes deleted at once — we never keep what we refused
 *   list   → the product's photos and whether a generation could start (an accepted front photo)
 *   remove → bytes and row gone
 *
 * Rules that are not style choices:
 *  - **The bytes decide, not the browser.** Format comes from the first bytes, size from storage,
 *    dimensions from the file's own header. A `.jpg` that is really an HEIC is refused as one.
 *  - **One photo per angle** (front, side, back; up to three details). A full angle is refused
 *    up front with what to do — no photo is silently replaced.
 *  - **Photos count against the plan's storage** from the moment an upload starts (the size the
 *    browser declared, corrected on confirm), so parallel uploads cannot overrun the limit.
 *  - **Confirm is idempotent**: confirming again answers with the verdict already given.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { generationPhotos, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { ANGLE_SLOTS, GENERATION_ANGLES, PHOTO_ISSUES, photoIssueViews, type GenerationAngle } from '@/lib/ai-jobs';
import type { GenerationPhotoSet, GenerationPhotoView } from '@/lib/view-models';
import { record } from '@/server/core/audit/audit';
import { assertStorageRoom } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import { forTenant } from '@/server/core/storage/storage';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { MAX_PHOTO_BYTES, PHOTO_CONTENT_TYPES, checkPhoto, sha256Hex, type PhotoFormat } from './photo-check';

type Photo = typeof generationPhotos.$inferSelect;

/** The presigned URL's life: long enough for a phone on a slow connection. */
export const PHOTO_UPLOAD_SECONDS = 15 * 60;

export type StartPhotoUpload = { angle: GenerationAngle; filename: string; contentType: string; sizeBytes: number };

async function ownProduct(db: TenantDb, productId: string): Promise<void> {
  const product = await db.findById(products, productId);
  if (!product || product.deletedAt) throw errors.notFound('product');
}

/** API-143 — a presigned PUT for one photo of one angle. */
export async function startPhotoUpload(ctx: TenantContext, productId: string, input: StartPhotoUpload): Promise<{ photoId: string; uploadUrl: string; contentType: string; expiresAt: string }> {
  ctx.require('models:write');
  const problems: Record<string, string[]> = {};
  if (!(GENERATION_ANGLES as readonly string[]).includes(input.angle)) problems.angle = ['front, side, back or detail'];
  const format = (Object.keys(PHOTO_CONTENT_TYPES) as PhotoFormat[]).find((f) => PHOTO_CONTENT_TYPES[f] === input.contentType);
  if (!format) problems.contentType = [PHOTO_ISSUES.unsupported_format.en];
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) problems.sizeBytes = ['the file is empty'];
  else if (input.sizeBytes > MAX_PHOTO_BYTES) problems.sizeBytes = [PHOTO_ISSUES.too_large_file.en];
  if (!input.filename?.trim()) problems.filename = ['required'];
  if (Object.keys(problems).length) throw errors.validation(problems);

  await assertStorageRoom(ctx, input.sizeBytes);
  const store = forTenant(ctx.tenantId);
  const photo = await withTenant(ctx.tenantId, async (db) => {
    await ownProduct(db, productId);
    await db.lockById(products, productId); // slots are counted and taken one upload at a time
    const taken = await db.count(generationPhotos, and(
      eq(generationPhotos.productId, productId), eq(generationPhotos.angle, input.angle),
      inArray(generationPhotos.status, ['uploading', 'accepted']),
    ));
    if (taken >= ANGLE_SLOTS[input.angle]) {
      throw errors.conflict(ANGLE_SLOTS[input.angle] === 1
        ? `this product already has a ${input.angle} photo — remove it first`
        : `this product already has ${taken} ${input.angle} photos — remove one first`);
    }
    const id = uuidv7();
    const row = await db.insert(generationPhotos, {
      id, productId, angle: input.angle, status: 'uploading',
      storageKey: store.key({ kind: 'photo', id, filename: input.filename }),
      originalFilename: input.filename.slice(0, 200), sizeBytes: input.sizeBytes,
    } as never);
    await record(ctx, { action: 'create', resourceType: 'generation_photo', resourceId: id, after: { productId, angle: input.angle } as never }, db);
    return row;
  });

  const contentType = PHOTO_CONTENT_TYPES[format!];
  const { url, expiresAt } = await store.presignUpload(photo.storageKey, { contentType, expiresInSeconds: PHOTO_UPLOAD_SECONDS });
  return { photoId: photo.id, uploadUrl: url, contentType, expiresAt: expiresAt.toISOString() };
}

/** API-144 — judge what arrived. Refused bytes are deleted before the answer. */
export async function confirmPhoto(ctx: TenantContext, productId: string, photoId: string): Promise<GenerationPhotoView> {
  ctx.require('models:write');
  const photo = await withTenant(ctx.tenantId, (db) => db.findById(generationPhotos, photoId));
  if (!photo || photo.productId !== productId) throw errors.notFound('photo');
  if (photo.status !== 'uploading') return view(photo);

  const store = forTenant(ctx.tenantId);
  const stored = await store.head(photo.storageKey);
  if (!stored) throw errors.conflict('the photo has not arrived yet — upload it to the URL you were given, then confirm');

  const bytes = stored.size > MAX_PHOTO_BYTES ? new Uint8Array() : await readAll(store, photo.storageKey);
  const sha = await sha256Hex(bytes);
  const others = await withTenant(ctx.tenantId, (db) => db.find(generationPhotos, and(
    eq(generationPhotos.productId, productId), eq(generationPhotos.status, 'accepted'),
  ), { limit: 20 }));
  const verdict = checkPhoto(bytes, stored.size, sha, others.map((p) => p.sha256).filter((h): h is string => !!h));
  if (!verdict.accepted) await store.delete(photo.storageKey);

  const after = await withTenant(ctx.tenantId, async (db) => {
    const before = await db.lockById(generationPhotos, photoId);
    if (before.status !== 'uploading') return before; // confirmed twice at once: the first verdict stands
    const row = await db.updateById(generationPhotos, photoId, {
      status: verdict.accepted ? 'accepted' : 'rejected',
      format: verdict.facts?.format ?? null, width: verdict.facts?.width ?? null, height: verdict.facts?.height ?? null,
      sizeBytes: stored.size, sha256: sha, qualityScore: verdict.score, issues: verdict.issues,
      bytesDeletedAt: verdict.accepted ? null : new Date(),
    } as never);
    await record(ctx, { action: 'update', resourceType: 'generation_photo', resourceId: photoId, before: { status: before.status } as never, after: { status: row.status, issues: verdict.issues } as never }, db);
    return row;
  });
  return view(after);
}

/** API-145 — the product's photos, and whether a generation could start from them. */
export async function listPhotos(ctx: TenantContext, productId: string): Promise<GenerationPhotoSet> {
  ctx.require('models:read');
  return withTenant(ctx.tenantId, async (db) => {
    await ownProduct(db, productId);
    const rows = await db.find(generationPhotos, eq(generationPhotos.productId, productId), { limit: 50, orderBy: asc(generationPhotos.id) });
    const accepted = new Set(rows.filter((r) => r.status === 'accepted').map((r) => r.angle));
    return {
      photos: rows.map(view),
      ready: accepted.has('front'),
      missing: (['front', 'side', 'back'] as const).filter((a) => !accepted.has(a)),
    };
  });
}

/** API-146 — remove a photo: its bytes, then its row. Frees its angle. */
export async function removePhoto(ctx: TenantContext, productId: string, photoId: string): Promise<void> {
  ctx.require('models:write');
  const photo = await withTenant(ctx.tenantId, (db) => db.findById(generationPhotos, photoId));
  if (!photo || photo.productId !== productId) throw errors.notFound('photo');
  if (!photo.bytesDeletedAt) await forTenant(ctx.tenantId).delete(photo.storageKey);
  await withTenant(ctx.tenantId, async (db) => {
    await db.deleteById(generationPhotos, photoId);
    await record(ctx, { action: 'delete', resourceType: 'generation_photo', resourceId: photoId, before: { angle: photo.angle, status: photo.status } as never }, db);
  });
}

/** The accepted photos a generation will use (P3.7 copies them into `generation_inputs`). */
export async function acceptedPhotos(db: TenantDb, productId: string): Promise<Photo[]> {
  return db.find(generationPhotos, and(eq(generationPhotos.productId, productId), eq(generationPhotos.status, 'accepted')), { limit: 20, orderBy: asc(generationPhotos.id) });
}

function view(photo: Photo): GenerationPhotoView {
  return {
    id: photo.id,
    angle: photo.angle,
    status: photo.status,
    format: (photo.format as GenerationPhotoView['format']) ?? null,
    width: photo.width, height: photo.height, sizeBytes: photo.sizeBytes,
    score: photo.qualityScore,
    issues: photoIssueViews(photo.issues ?? []),
    createdAt: photo.createdAt.toISOString(),
  };
}

/** The whole object, up to the cap (the caller has already refused anything larger). */
async function readAll(store: ReturnType<typeof forTenant>, storageKey: string): Promise<Uint8Array> {
  const object = await store.get(storageKey);
  if (!object) return new Uint8Array();
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
    if (length > MAX_PHOTO_BYTES) { await reader.cancel().catch(() => undefined); break; }
  }
  const out = new Uint8Array(Math.min(length, MAX_PHOTO_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.byteLength - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.byteLength) break;
  }
  return out;
}
