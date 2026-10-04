/**
 * P3.8 — a 3D model's picture: the view the merchant chose in the 3D editor, captured by the viewer.
 * The model list shows it, and once the model is live the published config names it, so the
 * product's own page (P1.19) has it as its link preview and its viewer shows it while loading.
 *
 * The same three steps as every upload here: a presigned PUT straight to storage, then a confirm that
 * checks the bytes themselves (`photo-check.ts`: what it really is, its header's size) and attaches
 * it. Only a key shaped exactly as this model's picture can be confirmed, so a request cannot attach
 * some other file of the store. Refused bytes are deleted at once; a replaced picture goes once the
 * live config no longer names it (T36). It counts against the plan's storage.
 */
import { and, eq, ne } from 'drizzle-orm';
import { models3d } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { PICTURE_MAX_ASPECT, PICTURE_MAX_BYTES, PICTURE_MAX_SIDE, PICTURE_MIN_SIDE, PICTURE_TYPES, type PictureType } from '@/lib/model-picture';
import { record } from '@/server/core/audit/audit';
import { assertStorageRoom } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import { forTenant } from '@/server/core/storage/storage';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { dimensions, sniff } from '@/server/modules/ai-jobs/photo-check';
import { keepLive } from '@/server/modules/edge/publish';
import { retireFile } from '@/server/modules/tryon/retire';
import { EXPIRED, notePendingUpload, takePendingUpload } from '@/server/modules/uploads/pending';

export const PICTURE_UPLOAD_SECONDS = 15 * 60;
const EXT_TYPE: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

async function modelOf(ctx: TenantContext, modelId: string) {
  const model = await ctx.db.findOne(models3d, and(eq(models3d.id, modelId), ne(models3d.status, 'archived')));
  if (!model) throw errors.notFound('model');
  return model;
}

/** API-127 — where to upload the picture. */
export async function startPictureUpload(ctx: TenantContext, modelId: string, input: { contentType: string; sizeBytes: number }): Promise<{ key: string; uploadUrl: string; contentType: string; expiresAt: string }> {
  ctx.require('models:write');
  const ext = PICTURE_TYPES[input.contentType as PictureType];
  const problems: Record<string, string[]> = {};
  if (!ext) problems.contentType = ['a WebP, PNG or JPEG picture'];
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) problems.sizeBytes = ['the picture is empty'];
  else if (input.sizeBytes > PICTURE_MAX_BYTES) problems.sizeBytes = ['at most 2 MB'];
  if (Object.keys(problems).length) throw errors.validation(problems);
  await modelOf(ctx, modelId);
  await assertStorageRoom(ctx, input.sizeBytes);
  const store = forTenant(ctx.tenantId);
  const key = store.key({ kind: 'model', id: modelId, filename: `picture-${uuidv7()}.${ext}` });
  await notePendingUpload(ctx.tenantId, key, 'model_picture'); // bytes never confirmed are swept
  const { url, expiresAt } = await store.presignUpload(key, { contentType: input.contentType, sizeBytes: input.sizeBytes, expiresInSeconds: PICTURE_UPLOAD_SECONDS });
  return { key, uploadUrl: url, contentType: input.contentType, expiresAt: expiresAt.toISOString() };
}

/** A key this model's picture upload would have — nothing else can be attached. */
export function isPictureKey(key: string, tenantId: string, modelId: string): boolean {
  return new RegExp(`^t/${tenantId}/model/${modelId}/picture-[0-9a-f-]{36}\\.(webp|png|jpg)$`).test(key);
}

/** Why these bytes cannot be the picture, or null. Checked from the file itself, never the browser's word. */
export function pictureProblem(bytes: Uint8Array, key: string): string | null {
  const format = sniff(bytes);
  const ext = key.slice(key.lastIndexOf('.') + 1);
  if (format !== 'webp' && format !== 'png' && format !== 'jpeg') return 'not a WebP, PNG or JPEG picture';
  if ((format === 'jpeg' ? 'jpg' : format) !== ext) return 'the picture is not the kind it was uploaded as';
  const size = dimensions(bytes, format);
  if (!size) return 'the picture could not be read';
  const { width, height } = size;
  if (Math.min(width, height) < PICTURE_MIN_SIDE) return `too small — at least ${PICTURE_MIN_SIDE} pixels a side`;
  if (Math.max(width, height) > PICTURE_MAX_SIDE) return `too large — at most ${PICTURE_MAX_SIDE} pixels a side`;
  if (Math.max(width, height) / Math.min(width, height) > PICTURE_MAX_ASPECT) return 'too long and thin for a picture of the model';
  return null;
}

/** API-128 — check what arrived and make it the model's picture, or delete it and say why. */
export async function confirmPicture(ctx: TenantContext, modelId: string, input: { key: string }): Promise<{ pictureBytes: number }> {
  ctx.require('models:write');
  if (typeof input.key !== 'string' || !isPictureKey(input.key, ctx.tenantId, modelId)) throw errors.notFound('upload');
  await modelOf(ctx, modelId);
  const store = forTenant(ctx.tenantId);
  const stored = await store.head(input.key);
  if (!stored) throw errors.conflict('the picture has not arrived yet — upload it to the URL you were given, then confirm');
  const object = stored.size > PICTURE_MAX_BYTES ? null : await store.get(input.key);
  const bytes = object ? new Uint8Array(await new Response(object.body).arrayBuffer()) : new Uint8Array();
  const problem = stored.size > PICTURE_MAX_BYTES ? 'at most 2 MB' : pictureProblem(bytes, input.key);
  if (problem) {
    await withTenant(ctx.tenantId, (db) => takePendingUpload(db, input.key));
    await store.delete(input.key);
    throw errors.validation({ picture: [problem] });
  }

  const { productId, replaced } = await withTenant(ctx.tenantId, async (db) => {
    if (!(await takePendingUpload(db, input.key))) throw errors.conflict(EXPIRED);
    const before = await db.lockById(models3d, modelId);
    await db.updateById(models3d, modelId, { pictureKey: input.key, pictureBytes: stored.size, updatedAt: new Date() });
    await record(ctx, { action: 'update', resourceType: 'model', resourceId: modelId, before: { pictureKey: before.pictureKey }, after: { pictureKey: input.key, pictureBytes: stored.size } }, db);
    return { productId: before.productId, replaced: before.pictureKey && before.pictureKey !== input.key ? before.pictureKey : null };
  });
  if (productId) await keepLive(ctx.tenantId, productId); // the live config names the new picture before the old one goes
  if (replaced) await retireFile(ctx.tenantId, productId, replaced);
  return { pictureBytes: stored.size };
}

/** API-129 — the picture, for the dashboard (its pages fetch with the session; an `<img>` cannot). */
export async function pictureFile(ctx: TenantContext, modelId: string): Promise<{ body: ReadableStream; contentType: string }> {
  ctx.require('models:read');
  const model = await modelOf(ctx, modelId);
  if (!model.pictureKey) throw errors.notFound('picture');
  const object = await forTenant(ctx.tenantId).get(model.pictureKey);
  if (!object) throw errors.notFound('picture');
  return { body: object.body, contentType: EXT_TYPE[model.pictureKey.slice(model.pictureKey.lastIndexOf('.') + 1)] ?? 'application/octet-stream' };
}
