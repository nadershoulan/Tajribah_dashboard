/**
 * P1.19 — a product's own page: its address, and the merchant's two choices (on or off, and the
 * link to buy it in their shop).
 *
 * The page itself is the website's (`tajribah-try-on/app/p/[store]/[product]`) and reads only the
 * published config, whose `page` block `edge/build.ts` writes from the row kept here. So a change is
 * live once the config is rewritten — done at once (`keepLive`), like every other change shoppers see.
 * The address exists while the product is published; it is built from the same store key and product
 * reference as the config's key, so the page and the shop's button always name the same product.
 */
import { eq } from 'drizzle-orm';
import { edgeConfigs, hostedPages, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { HostedPageInput, type HostedPageView } from '@/lib/contracts/hosted-page';
import { auditedInsert, auditedUpdate } from '@/server/core/audit/audit';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { keepLive } from '@/server/modules/edge/publish';
import { customHostOf, hostedPageViewOf } from './view';

export async function getHostedPage(ctx: TenantContext, productId: string): Promise<HostedPageView> {
  ctx.require('ar:read');
  const product = await ctx.db.findById(products, productId);
  if (!product || product.deletedAt) throw errors.notFound('product');
  const [page, edge, customHost] = await Promise.all([
    ctx.db.findOne(hostedPages, eq(hostedPages.productId, productId)),
    ctx.db.findOne(edgeConfigs, eq(edgeConfigs.productId, productId)),
    customHostOf(ctx),
  ]);
  return hostedPageViewOf(ctx.tenant.slug, product, page, edge, customHost);
}

/**
 * Saving is publishing's permission: the page is what shoppers see. Audited; the live config follows
 * at once, so a page switched off is gone within the config host's minute.
 */
export async function saveHostedPage(ctx: TenantContext, productId: string, input: unknown): Promise<HostedPageView> {
  ctx.require('ar:publish');
  const product = await ctx.db.findById(products, productId);
  if (!product || product.deletedAt) throw errors.notFound('product');
  const parsed = HostedPageInput.safeParse(input);
  if (!parsed.success) throw errors.validation(fieldErrorsFrom(parsed.error.issues));
  if (!(await entitlementsOf(ctx)).has('hosted_pages')) throw errors.forbidden('your plan does not include product pages');

  const values = { isActive: parsed.data.active, shopUrl: parsed.data.shopUrl };
  const existing = await ctx.db.findOne(hostedPages, eq(hostedPages.productId, productId));
  if (existing) {
    await auditedUpdate(ctx, hostedPages, existing.id, values, { resourceType: 'hosted_page' }); // the same choice records nothing
  } else {
    await auditedInsert(ctx, hostedPages, { id: uuidv7(), tenantId: ctx.tenantId, productId, ...values }, { resourceType: 'hosted_page' });
  }
  await keepLive(ctx.tenantId, productId);
  return getHostedPage(ctx, productId);
}
