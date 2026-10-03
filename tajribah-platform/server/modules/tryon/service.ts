/**
 * P5.10 — a merchant's try-on settings for their watches (T26: the owner's studio, unchanged).
 *
 * For each watch the studio needs two transparent pictures — the watch **as worn** (laid over the
 * wrist) and a **flat** product shot — its **case width** in millimetres (what makes it true to
 * size), and optionally a finish line ("Gold · green dial"). When all are there, the merchant can
 * switch it on and the shop's button opens the studio (published with the store's config, P1.15).
 *
 *  - Pictures upload straight to storage (presigned PUT), then a confirm checks the bytes
 *    (`cutout.ts`): PNG/WebP with transparency, big enough. Refused bytes are deleted at once;
 *    an accepted one replaces the old, whose bytes are deleted after the change commits.
 *  - A confirm only accepts a key shaped exactly as this store's cut-out for this slot, so a
 *    request cannot attach some other file of the store as a watch.
 *  - Reading is open to every role; every change needs `tryon:write`. **Every plan** sets watches
 *    up (T33: the studio's on-the-model view and true-size comparison are on every plan, as the
 *    website says); `onMe` tells the screen — and the published config — whether the shopper may
 *    also try the watch on their own photo (`virtual_tryon`, Pro and up).
 *  - Pictures count against the plan's storage (`storageBytesHeld`).
 *  - P5.9: each confirmed picture is queued for its check (`quality.ts`): empty edges cropped,
 *    the share of real size measured. The view shows a picture's check only while it is still
 *    that picture's (`quality[slot].key`), so a replaced picture shows "checking", never the old result.
 *  - T68 calibration: the merchant marks the case's edges on a picture; it is cropped to them in the
 *    background (`quality.ts`, sharp) and checked again — the screen shows "checking" meanwhile.
 *  - P5.13: the list shows each watch's last 30 days (views, try-on openings) from the analytics
 *    rollup — never raw events — to anyone who may read analytics.
 */
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { dailyProductStats, products, tryonConfigs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { CUTOUT_ISSUES } from '@/lib/tryon';
import { CALIBRATE_MIN_PX } from '@/lib/tryon-quality';
import type { TryOnScreen, TryOnWatchView } from '@/lib/view-models';
import { record } from '@/server/core/audit/audit';
import { assertStorageRoom, entitlementsOf } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import { forTenant } from '@/server/core/storage/storage';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { daysOf } from '@/server/modules/analytics/metrics';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { CUTOUT_MAX_BYTES, checkCutout, type CutoutIssue } from './cutout';
import { enqueueCalibration, enqueueQuality } from './quality-queue'; // not ./quality: it loads sharp
import { retireCutout } from './retire';
import { keepLive } from '@/server/modules/edge/publish';

export type Slot = 'worn' | 'flat';
type Config = typeof tryonConfigs.$inferSelect;
type Product = typeof products.$inferSelect;

const TYPES: Record<string, 'png' | 'webp'> = { 'image/png': 'png', 'image/webp': 'webp' };
export const UPLOAD_SECONDS = 15 * 60;

/** The English line for each refusal; the Arabic is beside it in `lib/tryon.ts`. */
export const ISSUE_TEXT = Object.fromEntries(Object.entries(CUTOUT_ISSUES).map(([code, text]) => [code, text.en])) as Record<CutoutIssue, string>;

type Last30 = TryOnWatchView['last30'];

function view(product: Product, config: Config | null, last30: Last30 = null): TryOnWatchView {
  const caseMm = config?.caseTenthsMm != null ? config.caseTenthsMm / 10 : null;
  const missing: TryOnWatchView['missing'] = [];
  if (!config?.wornKey) missing.push('worn');
  if (!config?.flatKey) missing.push('flat');
  if (caseMm === null) missing.push('case');
  const dims = product.dimensions as { widthMm?: number } | null;
  return {
    productId: product.id, name: product.name, nameAr: product.nameAr, sku: product.sku,
    productWidthMm: typeof dims?.widthMm === 'number' ? dims.widthMm : null,
    caseMm,
    worn: config?.wornKey ? { bytes: config.wornBytes ?? 0 } : null,
    flat: config?.flatKey ? { bytes: config.flatBytes ?? 0 } : null,
    finish: config?.finishAr && config.finishEn ? { ar: config.finishAr, en: config.finishEn } : null,
    enabled: !!config?.enabled && missing.length === 0,
    quality: {
      worn: config?.wornKey && config.quality?.worn?.key === config.wornKey ? config.quality.worn : null,
      flat: config?.flatKey && config.quality?.flat?.key === config.flatKey ? config.quality.flat : null,
      score: config?.qualityScore ?? null,
    },
    ready: missing.length === 0,
    missing,
    last30,
  };
}

async function watchOf(db: TenantDb, productId: string): Promise<Product> {
  const product = await db.findById(products, productId);
  if (!product || product.deletedAt) throw errors.notFound('product');
  if (product.productType !== 'watch') throw errors.conflict('try-on is for watches for now — set this product’s type to Watch first');
  return product;
}

async function mayChange(ctx: TenantContext): Promise<void> {
  ctx.require('tryon:write'); // T33: every plan may set watches up
}

/** API-150 — every watch in the store, with its try-on settings (and, P5.13, its last 30 days). */
export async function tryOnScreen(ctx: TenantContext, now = new Date()): Promise<TryOnScreen> {
  ctx.require('tryon:read');
  const onMe = (await entitlementsOf(ctx)).has('virtual_tryon');
  const days = daysOf('30d', now);
  return withTenant(ctx.tenantId, async (db) => {
    const watches = await db.find(products, and(eq(products.productType, 'watch'), isNull(products.deletedAt)), { limit: 500 });
    const ids = watches.map((p) => p.id);
    const configs = ids.length ? await db.find(tryonConfigs, inArray(tryonConfigs.productId, ids), { limit: 500 }) : [];
    const stats = ids.length && ctx.can('analytics:read')
      ? await db.find(dailyProductStats, and(inArray(dailyProductStats.productId, ids), gte(dailyProductStats.day, days[0]!), lte(dailyProductStats.day, days[days.length - 1]!)), { limit: 100_000 })
      : null;
    const last30 = (productId: string): Last30 => {
      if (!stats) return null;
      const rows = stats.filter((r) => r.productId === productId);
      return { views: rows.reduce((s, r) => s + r.views, 0), tryonSessions: rows.reduce((s, r) => s + r.tryonSessions, 0) };
    };
    return { onMe, watches: watches.map((p) => view(p, configs.find((c) => c.productId === p.id) ?? null, last30(p.id))) };
  });
}

/** API-151 — a presigned PUT for one picture of one watch. */
export async function startCutoutUpload(ctx: TenantContext, productId: string, input: { slot: Slot; filename: string; contentType: string; sizeBytes: number }): Promise<{ key: string; uploadUrl: string; contentType: string; expiresAt: string }> {
  await mayChange(ctx);
  const format = TYPES[input.contentType];
  const problems: Record<string, string[]> = {};
  if (input.slot !== 'worn' && input.slot !== 'flat') problems.slot = ['worn or flat'];
  if (!format) problems.contentType = [ISSUE_TEXT.not_png_or_webp];
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) problems.sizeBytes = ['the file is empty'];
  else if (input.sizeBytes > CUTOUT_MAX_BYTES) problems.sizeBytes = [ISSUE_TEXT.too_large_file];
  if (Object.keys(problems).length) throw errors.validation(problems);
  await withTenant(ctx.tenantId, (db) => watchOf(db, productId));
  await assertStorageRoom(ctx, input.sizeBytes);
  const store = forTenant(ctx.tenantId);
  const key = store.key({ kind: 'photo', id: uuidv7(), filename: `${input.slot}.${format}` });
  const contentType = input.contentType;
  const { url, expiresAt } = await store.presignUpload(key, { contentType, expiresInSeconds: UPLOAD_SECONDS });
  return { key, uploadUrl: url, contentType, expiresAt: expiresAt.toISOString() };
}

/** A key this store's cut-out upload for `slot` would have — nothing else can be attached. */
function isCutoutKey(key: string, tenantId: string, slot: Slot): boolean {
  return new RegExp(`^t/${tenantId}/photo/[0-9a-f-]{36}/${slot}\\.(png|webp)$`).test(key);
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** API-152 — check what arrived; attach it to the watch, or delete it and say why. */
export async function confirmCutout(ctx: TenantContext, productId: string, input: { slot: Slot; key: string }): Promise<TryOnWatchView> {
  await mayChange(ctx);
  if ((input.slot !== 'worn' && input.slot !== 'flat') || !isCutoutKey(input.key, ctx.tenantId, input.slot)) throw errors.notFound('upload');
  await withTenant(ctx.tenantId, (db) => watchOf(db, productId));
  const store = forTenant(ctx.tenantId);
  const stored = await store.head(input.key);
  if (!stored) throw errors.conflict('the picture has not arrived yet — upload it to the URL you were given, then confirm');
  const object = stored.size > CUTOUT_MAX_BYTES ? null : await store.get(input.key);
  const bytes = object ? await readAll(object.body) : new Uint8Array();
  const verdict = checkCutout(bytes, stored.size);
  if (!verdict.ok) {
    await store.delete(input.key);
    throw errors.validation({ [input.slot]: [ISSUE_TEXT[verdict.issue]] });
  }

  const { result, replaced } = await withTenant(ctx.tenantId, async (db) => {
    const product = await db.lockById(products, productId);
    const before = await db.findOne(tryonConfigs, eq(tryonConfigs.productId, productId));
    const values = input.slot === 'worn' ? { wornKey: input.key, wornBytes: stored.size } : { flatKey: input.key, flatBytes: stored.size };
    const after = before
      ? await db.updateById(tryonConfigs, before.id, values as never)
      : await db.insert(tryonConfigs, { id: uuidv7(), productId, category: 'watch', ...values } as never);
    await record(ctx, { action: before ? 'update' : 'create', resourceType: 'tryon_config', resourceId: after.id, before: before ? { [`${input.slot}Key`]: before[`${input.slot}Key`] } as never : undefined, after: { [`${input.slot}Key`]: input.key } as never }, db);
    const old = before?.[`${input.slot}Key`];
    return { result: view(product, after), replaced: old && old !== input.key ? old : null };
  });
  await keepLive(ctx.tenantId, productId); // P1.15: before the old picture goes, the live config stops naming it
  if (replaced) await retireCutout(ctx.tenantId, productId, replaced); // T36: kept a while if shoppers may still hold it
  await enqueueQuality(ctx.tenantId, productId, input.slot, input.key);
  return result;
}

/** API-153 — case width, finish, on/off. Switching on needs both pictures and a case width. */
export async function updateTryOn(ctx: TenantContext, productId: string, patch: { caseMm?: number | null; finishAr?: string | null; finishEn?: string | null; enabled?: boolean }): Promise<TryOnWatchView> {
  await mayChange(ctx);
  const problems: Record<string, string[]> = {};
  if (patch.caseMm != null && (!Number.isFinite(patch.caseMm) || patch.caseMm < 5 || patch.caseMm > 80)) problems.caseMm = ['between 5 and 80 mm'];
  const finish = [patch.finishAr, patch.finishEn];
  if (finish.some((f) => f !== undefined) && finish.filter((f) => f && f.trim()).length === 1) problems.finish = ['in both Arabic and English, or neither'];
  if (finish.some((f) => f && f.trim().length > 80)) problems.finish = ['80 characters at most'];
  if (Object.keys(problems).length) throw errors.validation(problems);

  const result = await withTenant(ctx.tenantId, async (db) => {
    const product = await watchOf(db, productId);
    await db.lockById(products, productId);
    const before = await db.findOne(tryonConfigs, eq(tryonConfigs.productId, productId));
    const values: Partial<Config> = {};
    if (patch.caseMm !== undefined) values.caseTenthsMm = patch.caseMm === null ? null : Math.round(patch.caseMm * 10);
    if (patch.finishAr !== undefined || patch.finishEn !== undefined) {
      const ar = patch.finishAr?.trim() || null;
      const en = patch.finishEn?.trim() || null;
      values.finishAr = ar && en ? ar : null;
      values.finishEn = ar && en ? en : null;
    }
    if (patch.enabled !== undefined) values.enabled = patch.enabled;
    const next = { ...(before ?? {}), ...values } as Config;
    if (next.enabled) {
      const missing = view(product, next).missing;
      if (missing.length) throw errors.conflict(`try-on cannot be switched on yet — missing: ${missing.join(', ')}`);
    }
    const after = before
      ? await db.updateById(tryonConfigs, before.id, values as never)
      : await db.insert(tryonConfigs, { id: uuidv7(), productId, category: 'watch', ...values } as never);
    await record(ctx, { action: before ? 'update' : 'create', resourceType: 'tryon_config', resourceId: after.id, before: before as never, after: after as never }, db);
    return view(product, after);
  });
  await keepLive(ctx.tenantId, productId); // P1.15: switched off → gone from the shop; case width, finish → rewritten
  return result;
}

/**
 * API-178 — calibration: crop a picture to the case's marked edges (pixel columns of the picture as
 * stored, `right` exclusive). `key` is the picture the merchant marked (`quality[slot].key`): if it
 * has been replaced since, the marks are for another picture and nothing is done.
 */
export async function calibrateCutoutEdges(ctx: TenantContext, productId: string, input: { slot: Slot; key: string; left: number; right: number }): Promise<TryOnWatchView> {
  await mayChange(ctx);
  const problems: Record<string, string[]> = {};
  if (input.slot !== 'worn' && input.slot !== 'flat') problems.slot = ['worn or flat'];
  if (!Number.isInteger(input.left) || !Number.isInteger(input.right) || input.left < 0 || input.right - input.left < CALIBRATE_MIN_PX) problems.edges = [`the case’s edges, at least ${CALIBRATE_MIN_PX} pixels apart`];
  if (Object.keys(problems).length) throw errors.validation(problems);
  const result = await withTenant(ctx.tenantId, async (db) => {
    const product = await watchOf(db, productId);
    await db.lockById(products, productId);
    const before = await db.findOne(tryonConfigs, eq(tryonConfigs.productId, productId));
    if (!before || before[`${input.slot}Key`] !== input.key) throw errors.conflict('the picture has changed since you marked it — mark it again');
    const quality = { ...(before.quality ?? {}) };
    delete quality[input.slot]; // "checking" until the cropped picture is checked
    const after = await db.updateById(tryonConfigs, before.id, { quality } as never);
    return view(product, after);
  });
  await enqueueCalibration(ctx.tenantId, productId, input.slot, input.key, { left: input.left, right: input.right });
  return result;
}

/** API-154 — one stored picture, for the settings screen's preview. */
export async function cutoutFile(ctx: TenantContext, productId: string, slot: Slot): Promise<{ body: ReadableStream; contentType: string }> {
  ctx.require('tryon:read');
  const config = await withTenant(ctx.tenantId, (db) => db.findOne(tryonConfigs, eq(tryonConfigs.productId, productId)));
  const key = slot === 'worn' ? config?.wornKey : slot === 'flat' ? config?.flatKey : null;
  if (!key) throw errors.notFound('picture');
  const object = await forTenant(ctx.tenantId).get(key);
  if (!object) throw errors.notFound('picture');
  return { body: object.body, contentType: key.endsWith('.webp') ? 'image/webp' : 'image/png' };
}
