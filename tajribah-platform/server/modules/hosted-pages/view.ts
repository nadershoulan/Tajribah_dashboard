/**
 * P1.19 — a product's own page as the AR settings screen shows it. Reads only (no imports of the
 * publishing path), so the AR settings service can use it without a cycle.
 */
import { eq } from 'drizzle-orm';
import { customDomains, type edgeConfigs, type hostedPages, type products } from '@/db/schema';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import type { TenantContext } from '@/server/core/tenancy/context';
import { DEFAULT_HOSTED_PAGE_BASE, hostedPageUrl, isShopUrl, type HostedPageView } from '@/lib/contracts/hosted-page';
import { loadEnv } from '@/server/core/config/env';

type Product = typeof products.$inferSelect;
type Page = typeof hostedPages.$inferSelect;
type Edge = typeof edgeConfigs.$inferSelect;

/** The store's own address for its pages, when it is switched on and the plan has it — what `build.ts` publishes. */
export async function customHostOf(ctx: TenantContext): Promise<string | null> {
  const domain = await ctx.db.findOne(customDomains, eq(customDomains.status, 'active'));
  return domain && (await entitlementsOf(ctx)).has('custom_domain') ? domain.hostname : null;
}

/**
 * `HOSTED_PAGE_BASE`, or the default. A running app has validated its environment at boot, so the read
 * cannot fail there; code run without a boot (a unit test of a screen's read) gets the default.
 */
export function hostedPageBase(): string {
  try { return loadEnv().HOSTED_PAGE_BASE ?? DEFAULT_HOSTED_PAGE_BASE; } catch { return DEFAULT_HOSTED_PAGE_BASE; }
}

/**
 * What the AR settings screen shows: the address while the product is live, and the two choices. On a
 * store's own address once it is switched on (`customHost`, T62 — the config names it, as `build.ts`
 * does), Tajribah's otherwise.
 */
export function hostedPageViewOf(store: string, product: Product, page: Page | null, edge: Edge | null | undefined, customHost: string | null = null): HostedPageView {
  const live = !!edge?.key && !edge.withdrawnAt;
  const base = customHost ? `https://${customHost}/p` : hostedPageBase();
  return {
    url: live ? hostedPageUrl(base, store, product.externalId ?? product.id) : null,
    active: page?.isActive ?? true,
    shopUrl: page?.shopUrl ?? null,
    storePage: product.pageUrl && isShopUrl(product.pageUrl) ? product.pageUrl : null,
  };
}
