/**
 * P1.15 — one product's viewer config, assembled from the database: what the shop's widget
 * (`widget/src/config.ts`, contract v1) and the try-on page (`tajribah-try-on/lib/tryon-config.ts`)
 * read at `{store key}/{product ref}.json`.
 *
 *  - **Button**: the product's AR settings (`ar/service.ts` — defaults until saved) in the store's
 *    brand colour and corner radius (Settings).
 *  - **Model**: when the product's AR is on — its model's live version (`current_version_id`,
 *    `ready`): the web GLB (required), the plain GLB for Android and the USDZ for iPhone when made.
 *  - **Try-on**: a watch whose try-on is switched on and complete, placed on the wrist — the two
 *    cut-outs, the case width, the SKU and finish; `onMe` from the plan (`virtual_tryon`, T33).
 *  - **Brand** (T61, white-label — Enterprise): the store's name and logo, which the try-on page
 *    and its phone page show in Tajribah's place. Only with a try-on; null on every other plan.
 *  - **Host** (T62, custom domains — Enterprise): the store's own address, once it is switched on
 *    (`active`); the shop's widget then opens the try-on there instead of on Tajribah's address.
 *  - Nothing to open (no model, no try-on) or a product that is archived, deleted, or in a store
 *    that is suspended or closed → no config, with the reason.
 *
 * The result is checked with the widget's own parser before it can be published, so a config the
 * shop cannot read never leaves: the contract has one definition, not two that drift.
 */
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { arConfigs, customDomains, modelFiles, models3d, products, tenantSettings, tryonConfigs } from '@/db/schema';
import { DEFAULT_BUTTON_COLOR, DEFAULT_BUTTON_RADIUS } from '@/lib/contracts/settings';
import type { Entitlements } from '@/server/core/billing/entitlements';
import { configKey } from '@/server/core/edge/configs';
import { log } from '@/server/core/observability/log';
import { forTenant } from '@/server/core/storage/storage';
import type { TenantContext } from '@/server/core/tenancy/context';
import { arViewOf } from '@/server/modules/ar/service';
import { fileFor } from '@/server/modules/models/files';
import { parseConfig, type ViewerConfig } from '@/widget/src/config';

/** Why a product has no config. */
export type EdgeBlock = 'unavailable' | 'store_closed' | 'nothing_to_show' | 'invalid';

export const BLOCK_TEXT: Record<EdgeBlock, string> = {
  unavailable: 'this product is archived or deleted',
  store_closed: 'this store is suspended or closed',
  nothing_to_show: 'nothing for the button to open yet — switch AR on with a live 3D model, or set up the watch’s try-on',
  invalid: 'the settings do not make a valid config — please contact support',
};

/** What is published: the widget's contract, plus what only the try-on page reads — the finish line and the brand. */
export type PublishedConfig = Omit<ViewerConfig, 'tryon'> & {
  tryon: (NonNullable<ViewerConfig['tryon']> & { finish: { ar: string; en: string } | null }) | null;
  brand: StoreBrand | null;
};

export type StoreBrand = { name: string; nameAr: string | null; logo: string | null };

export type EdgeBuild =
  | { ok: true; key: string; config: PublishedConfig; body: string; fingerprint: string }
  | { ok: false; key: string | null; reason: EdgeBlock };

const CLOSED = new Set(['suspended', 'cancelled']);

export async function buildEdgeConfig(ctx: TenantContext, productId: string, entitlements: Entitlements): Promise<EdgeBuild> {
  const db = ctx.db;
  const tenant = ctx.tenant;
  const product = await db.findById(products, productId);
  if (!product || product.deletedAt || product.status === 'archived') return { ok: false, key: null, reason: 'unavailable' };
  const key = configKey(tenant.slug, product.externalId ?? product.id);
  if (CLOSED.has(tenant.status)) return { ok: false, key, reason: 'store_closed' };

  const [ar, tryon, settings, domain] = await Promise.all([
    db.findOne(arConfigs, eq(arConfigs.productId, productId)),
    db.findOne(tryonConfigs, eq(tryonConfigs.productId, productId)),
    db.findOne(tenantSettings),
    entitlements.has('custom_domain') ? db.findOne(customDomains, eq(customDomains.status, 'active')) : null,
  ]);
  const button = arViewOf(product, ar ?? null);
  const files = forTenant(ctx.tenantId);
  const dims = product.dimensions as { widthMm?: unknown; heightMm?: unknown } | null;
  const mm = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

  const model = product.arEnabled ? await liveModelOf(ctx, product.id, product.primaryModelId, (k) => files.publicUrl(k)) : null;
  const watch = tryon && tryon.enabled && tryon.wornKey && tryon.flatKey && tryon.caseTenthsMm != null && button.placement === 'wrist'
    ? {
      worn: files.publicUrl(tryon.wornKey),
      flat: files.publicUrl(tryon.flatKey),
      caseMm: tryon.caseTenthsMm / 10,
      sku: product.sku && product.sku.length <= 64 ? product.sku : null,
      onMe: entitlements.has('virtual_tryon'),
      finish: tryon.finishAr && tryon.finishEn ? { ar: tryon.finishAr, en: tryon.finishEn } : null,
    }
    : null;
  if (!model && !watch) return { ok: false, key, reason: 'nothing_to_show' };

  const config: PublishedConfig = {
    v: 1,
    // A synced name can be longer than the contract's 200 characters; it is a label here, so it is cut, not refused.
    product: { name: product.name.slice(0, 200), nameAr: product.nameAr?.slice(0, 200) || null, widthMm: mm(dims?.widthMm), heightMm: mm(dims?.heightMm) },
    model,
    button: {
      labelAr: button.buttonLabelAr, labelEn: button.buttonLabelEn,
      color: settings?.branding?.primary ?? DEFAULT_BUTTON_COLOR,
      radius: settings?.branding?.buttonRadius ?? DEFAULT_BUTTON_RADIUS,
      variant: button.variant, icon: button.showIcon,
    },
    placement: button.placement,
    scale: button.scale,
    autoRotate: button.autoRotate,
    shadow: button.shadow,
    tryon: watch,
    brand: watch && entitlements.has('white_label') ? brandOf(tenant, settings?.branding?.logoUrl) : null,
    host: watch && domain ? domain.hostname : null,
  };
  const body = JSON.stringify(config);
  if (!parseConfig(JSON.parse(body))) {
    log.error('edge config refused by the widget parser', { tenantId: ctx.tenantId, productId });
    return { ok: false, key, reason: 'invalid' };
  }
  return { ok: true, key, config, body, fingerprint: await sha256(body) };
}

/** The store's name (both languages) and logo — the Settings logo first, then the store's own; https only. */
function brandOf(tenant: { name: string; nameAr: string | null; logoUrl: string | null }, settingsLogo: string | undefined): StoreBrand {
  const https = (v: string | null | undefined) => {
    if (!v || v.length > 2048) return null;
    try { return new URL(v).protocol === 'https:' ? v : null; } catch { return null; }
  };
  return { name: tenant.name.slice(0, 80), nameAr: tenant.nameAr?.slice(0, 80) || null, logo: https(settingsLogo) ?? https(tenant.logoUrl) };
}

/** The product's live 3D files, or null when it has none that the shop can show. */
async function liveModelOf(ctx: TenantContext, productId: string, primaryModelId: string | null, url: (key: string) => string): Promise<ViewerConfig['model']> {
  const live = await ctx.db.find(models3d, and(eq(models3d.productId, productId), eq(models3d.status, 'ready'), isNotNull(models3d.currentVersionId)),
    { limit: 20, orderBy: [desc(models3d.updatedAt)] });
  const chosen = live.find((m) => m.id === primaryModelId) ?? live[0];
  if (!chosen?.currentVersionId) return null;
  const stored = await ctx.db.find(modelFiles, and(eq(modelFiles.modelVersionId, chosen.currentVersionId), isNull(modelFiles.bytesDeletedAt)), { limit: 20 });
  const at = (role: 'web' | 'native' | 'quickLook') => {
    const file = fileFor(stored, role);
    return file ? file.cdnUrl ?? url(file.storageKey) : null;
  };
  const glb = at('web');
  return glb ? { glb, glbNative: at('native'), usdz: at('quickLook') } : null;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
