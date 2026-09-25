/**
 * P1.21 — AR button and viewer settings, per product.
 *
 * A product without a saved row shows the defaults (`DEFAULT_AR_CONFIG`) and a placement that
 * fits its type; nothing is written until the merchant saves. Saving is audited. Publishing —
 * copying the config to the edge store the shopper's page reads (P1.15, needs Cloudflare KV) —
 * is not here: `unpublishedChanges` tells the screen that shoppers still see the older one.
 */
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { arConfigs, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { ArConfigInput, DEFAULT_AR_CONFIG, placementErrors, placementsFor, type ArConfigView } from '@/lib/contracts/ar-config';
import { auditedInsert, auditedUpdate } from '@/server/core/audit/audit';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';

type Product = typeof products.$inferSelect;
type Config = typeof arConfigs.$inferSelect;

export async function listArConfigs(ctx: TenantContext): Promise<ArConfigView[]> {
  ctx.require('ar:read');
  const rows = await ctx.db.find(products, and(isNull(products.deletedAt), ne(products.status, 'archived')), { limit: 500 });
  const configs = rows.length ? await ctx.db.find(arConfigs, inArray(arConfigs.productId, rows.map((p) => p.id)), { limit: 500 }) : [];
  return rows.map((p) => viewOf(p, configs.find((c) => c.productId === p.id) ?? null));
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
  return viewOf(product, saved);
}

function viewOf(p: Product, c: Config | null): ArConfigView {
  return {
    productId: p.id, productName: p.name, productNameAr: p.nameAr, productType: p.productType, arEnabled: p.arEnabled,
    buttonLabelAr: c?.buttonLabelAr ?? DEFAULT_AR_CONFIG.buttonLabelAr,
    buttonLabelEn: c?.buttonLabelEn ?? DEFAULT_AR_CONFIG.buttonLabelEn,
    variant: c?.buttonStyle?.variant === 'outline' ? 'outline' : 'solid',
    showIcon: c?.buttonStyle?.icon ?? DEFAULT_AR_CONFIG.showIcon,
    placement: c?.placement ?? placementsFor(p.productType)[0],
    scale: (c?.scaleFactorBp ?? 10_000) / 10_000,
    autoRotate: c?.autoRotate ?? DEFAULT_AR_CONFIG.autoRotate,
    shadow: (c?.shadowIntensityBp ?? 10_000) / 10_000,
    saved: !!c,
    publishedVersion: c?.publishedVersion ?? 0,
    unpublishedChanges: !!c && (!c.publishedAt || c.updatedAt.getTime() > c.publishedAt.getTime()),
  };
}
