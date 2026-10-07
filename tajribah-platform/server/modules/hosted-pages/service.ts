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
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { edgeConfigs, hostedPages, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { HostedPageInput, isShopUrl, type HostedPageView } from '@/lib/contracts/hosted-page';
import { auditedInsert, auditedUpdate } from '@/server/core/audit/audit';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { enqueueEdgeRefresh, keepLive } from '@/server/modules/edge/publish';
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

/** Up to this many pages are brought live one by one, at once; more go through one store-wide refresh. */
export const STORE_PAGES_AT_ONCE = 25;

/**
 * T99 — at the owner's one request (the QR codes screen), every published product whose own page has no buy
 * link yet gets its page in the store, from its feed, as the buy link. A link the owner set is never touched,
 * and a page switched off stays off. Audited per product, like a save on AR settings.
 */
export async function applyStorePages(ctx: TenantContext): Promise<{ updated: number }> {
  ctx.require('ar:publish');
  if (!(await entitlementsOf(ctx)).has('hosted_pages')) throw errors.forbidden('your plan does not include product pages');
  const live = await ctx.db.find(edgeConfigs, and(isNotNull(edgeConfigs.key), isNull(edgeConfigs.withdrawnAt)), { limit: 5000 });
  if (!live.length) return { updated: 0 };
  const ids = live.map((r) => r.productId);
  const [rows, pages] = await Promise.all([
    ctx.db.find(products, and(inArray(products.id, ids), isNull(products.deletedAt), isNotNull(products.pageUrl)), { limit: ids.length }),
    ctx.db.find(hostedPages, inArray(hostedPages.productId, ids), { limit: ids.length }),
  ]);
  const pageOf = new Map(pages.map((p) => [p.productId, p]));
  const changed: string[] = [];
  for (const product of rows) {
    if (!product.pageUrl || !isShopUrl(product.pageUrl)) continue;
    const existing = pageOf.get(product.id);
    if (existing?.shopUrl) continue; // the owner's own choice
    if (existing) await auditedUpdate(ctx, hostedPages, existing.id, { shopUrl: product.pageUrl }, { resourceType: 'hosted_page' });
    else await auditedInsert(ctx, hostedPages, { id: uuidv7(), tenantId: ctx.tenantId, productId: product.id, isActive: true, shopUrl: product.pageUrl }, { resourceType: 'hosted_page' });
    changed.push(product.id);
  }
  if (changed.length <= STORE_PAGES_AT_ONCE) for (const id of changed) await keepLive(ctx.tenantId, id);
  else await enqueueEdgeRefresh(ctx.tenantId);
  return { updated: changed.length };
}
