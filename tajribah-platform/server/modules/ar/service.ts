/**
 * P1.21 — AR button and viewer settings, per product.
 *
 * A product without a saved row shows the defaults (`DEFAULT_AR_CONFIG`) and a placement that
 * fits its type; nothing is written until the merchant saves. Saving is audited. Publishing —
 * the product's whole config, to the store shops read — is `edge/publish.ts` (P1.15); the view
 * carries its status: the version shoppers see, and whether what would be published now differs.
 */
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { arConfigs, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { ArConfigInput, DEFAULT_AR_CONFIG, defaultLabelsFor, placementErrors, placementsFor, type ArConfigView } from '@/lib/contracts/ar-config';
import { auditedInsert, auditedUpdate } from '@/server/core/audit/audit';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { edgeStatuses, type EdgeStatus } from '@/server/modules/edge/publish';

type Product = typeof products.$inferSelect;
type Config = typeof arConfigs.$inferSelect;

export async function listArConfigs(ctx: TenantContext): Promise<ArConfigView[]> {
  ctx.require('ar:read');
  const rows = await ctx.db.find(products, and(isNull(products.deletedAt), ne(products.status, 'archived')), { limit: 500 });
  const configs = rows.length ? await ctx.db.find(arConfigs, inArray(arConfigs.productId, rows.map((p) => p.id)), { limit: 500 }) : [];
  const live = await edgeStatuses(ctx, rows.map((p) => p.id));
  return rows.map((p) => withEdge(arViewOf(p, configs.find((c) => c.productId === p.id) ?? null), live.get(p.id)));
}

/** P1.15: what shoppers see, from `edge_configs` — the settings row's own publish columns are unused. */
function withEdge(view: ArConfigView, live: EdgeStatus | undefined): ArConfigView {
  return live
    ? { ...view, publishedVersion: live.version, publishedAt: live.publishedAt, unpublishedChanges: live.outdated }
    : view;
}

export async function saveArConfig(ctx: TenantContext, productId: string, input: unknown): Promise<ArConfigView> {
  ctx.require('ar:write');
  const product = await ctx.db.findById(products, productId);
  if (!product || product.deletedAt) throw errors.notFound('product');
  const parsed = ArConfigInput.safeParse(input);
  if (!parsed.success) throw errors.validation(fieldErrorsFrom(parsed.error.issues));
  const c = parsed.data;
  const placement = placementErrors(product.productType, c.placement);
  if (Object.keys(placement).length) throw errors.validation(placement);

  const values = {
    buttonLabelAr: c.buttonLabelAr, buttonLabelEn: c.buttonLabelEn,
    buttonStyle: { variant: c.variant, icon: c.showIcon },
    placement: c.placement, autoRotate: c.autoRotate,
    scaleFactorBp: Math.round(c.scale * 10_000), shadowIntensityBp: Math.round(c.shadow * 10_000),
  };
  const existing = await ctx.db.findOne(arConfigs, eq(arConfigs.productId, productId));
  if (existing) await auditedUpdate(ctx, arConfigs, existing.id, values, { resourceType: 'ar_config' });
  else await auditedInsert(ctx, arConfigs, { id: uuidv7(), tenantId: ctx.tenantId, productId, ...values }, { resourceType: 'ar_config' });
  const saved = await ctx.db.findOne(arConfigs, eq(arConfigs.productId, productId));
  return withEdge(arViewOf(product, saved), (await edgeStatuses(ctx, [productId])).get(productId));
}

/** A product's AR settings as shown and as published (P1.15): the saved row, or the defaults. */
export function arViewOf(p: Product, c: Config | null): ArConfigView {
  return {
    productId: p.id, productName: p.name, productNameAr: p.nameAr, productType: p.productType, arEnabled: p.arEnabled,
    buttonLabelAr: c?.buttonLabelAr ?? defaultLabelsFor(p.productType).buttonLabelAr,
    buttonLabelEn: c?.buttonLabelEn ?? defaultLabelsFor(p.productType).buttonLabelEn,
    variant: c?.buttonStyle?.variant === 'outline' ? 'outline' : 'solid',
    showIcon: c?.buttonStyle?.icon ?? DEFAULT_AR_CONFIG.showIcon,
    placement: c?.placement ?? placementsFor(p.productType)[0],
    scale: (c?.scaleFactorBp ?? 10_000) / 10_000,
    autoRotate: c?.autoRotate ?? DEFAULT_AR_CONFIG.autoRotate,
    shadow: (c?.shadowIntensityBp ?? 10_000) / 10_000,
    saved: !!c,
    publishedVersion: 0,
    publishedAt: null,
    unpublishedChanges: !!c,
  };
}
