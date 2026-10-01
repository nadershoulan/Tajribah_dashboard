/**
 * P1.19 — a product's own page as the AR settings screen shows it. Pure (no writes, no imports of the
 * publishing path), so the AR settings service can use it without a cycle.
 */
import type { edgeConfigs, hostedPages, products } from '@/db/schema';
import { DEFAULT_HOSTED_PAGE_BASE, hostedPageUrl, type HostedPageView } from '@/lib/contracts/hosted-page';
import { loadEnv } from '@/server/core/config/env';

type Product = typeof products.$inferSelect;
type Page = typeof hostedPages.$inferSelect;
type Edge = typeof edgeConfigs.$inferSelect;

/**
 * `HOSTED_PAGE_BASE`, or the default. A running app has validated its environment at boot, so the read
 * cannot fail there; code run without a boot (a unit test of a screen's read) gets the default.
 */
export function hostedPageBase(): string {
  try { return loadEnv().HOSTED_PAGE_BASE ?? DEFAULT_HOSTED_PAGE_BASE; } catch { return DEFAULT_HOSTED_PAGE_BASE; }
}

/** What the AR settings screen shows: the address while the product is live, and the two choices. */
export function hostedPageViewOf(store: string, product: Product, page: Page | null, edge: Edge | null | undefined): HostedPageView {
  const live = !!edge?.key && !edge.withdrawnAt;
  return {
    url: live ? hostedPageUrl(hostedPageBase(), store, product.externalId ?? product.id) : null,
    active: page?.isActive ?? true,
    shopUrl: page?.shopUrl ?? null,
  };
}
