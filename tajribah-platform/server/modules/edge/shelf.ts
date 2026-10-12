/**
 * T140.1 — the store's try-on shelf, for "this watch or that one" on the shopper's own photo (Nader). The try-on page
 * knows only its own product; to put a second one beside it, it needs the store's other try-on products. The shelf is
 * that list — each live product's try-on as its own config publishes it (pictures, real size, kind, and its store page
 * when known) — kept next to the configs, at the reserved ref `shelf:tryons` (as `page:` refs are reserved, T95), so the
 * try-on page reads it from the config host like any config, never from Postgres.
 *
 * Rebuilt whenever a product is published, rewritten, withdrawn or taken down; most recently published first, at most
 * `SHELF_MAX`. A failure never fails the publish itself (the next publish rebuilds it).
 */
import { and, desc, inArray, isNotNull, isNull } from 'drizzle-orm';
import { edgeConfigs, products } from '@/db/schema';
import { configKey, configStore } from '@/server/core/edge/configs';
import { log } from '@/server/core/observability/log';
import type { TenantContext } from '@/server/core/tenancy/context';

export const SHELF_REF = 'shelf:tryons';
export const SHELF_MAX = 40;

export type ShelfEntry = { ref: string; name: string; nameAr: string | null; category: string; caseMm: number; worn: string; flat: string; page: string | null };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A published config's try-on as a shelf entry; null when it has none (a 3D-only product). */
export function shelfEntryOf(config: unknown, ref: string, page: string | null): ShelfEntry | null {
  if (!isObj(config) || !isObj(config.product) || !isObj(config.tryon)) return null;
  const { product, tryon } = config;
  if (typeof product.name !== 'string' || typeof tryon.worn !== 'string' || typeof tryon.flat !== 'string' || typeof tryon.caseMm !== 'number') return null;
  return {
    ref, name: product.name, nameAr: typeof product.nameAr === 'string' ? product.nameAr : null,
    category: typeof tryon.category === 'string' ? tryon.category : 'watch',
    caseMm: tryon.caseMm, worn: tryon.worn, flat: tryon.flat,
    page: page && /^https:\/\//.test(page) ? page : null,
  };
}

/** The product ref a config key names (`{store}/{ref}.json`). */
export const refOfKey = (key: string): string | null => {
  const m = /^[^/]+\/([^/]+)\.json$/.exec(key);
  return m ? decodeURIComponent(m[1]!) : null;
};

/** Rebuild the store's shelf from its live configs; the number of products on it. */
export async function refreshShelf(ctx: TenantContext): Promise<number> {
  try {
    const live = await ctx.db.find(edgeConfigs, and(isNotNull(edgeConfigs.key), isNull(edgeConfigs.withdrawnAt)), { limit: 500, orderBy: [desc(edgeConfigs.publishedAt)] });
    const pages = new Map((live.length ? await ctx.db.find(products, inArray(products.id, live.map((r) => r.productId)), { limit: live.length }) : []).map((p) => [p.id, p.pageUrl ?? null]));
    const entries: ShelfEntry[] = [];
    for (const row of live) {
      if (entries.length >= SHELF_MAX) break;
      const ref = row.key ? refOfKey(row.key) : null;
      const body = ref ? await configStore().get(row.key!) : null;
      if (!ref || !body) continue;
      let config: unknown = null;
      try { config = JSON.parse(body); } catch { continue; }
      const entry = shelfEntryOf(config, ref, pages.get(row.productId) ?? null);
      if (entry) entries.push(entry);
    }
    const key = configKey(ctx.tenant.slug, SHELF_REF);
    if (entries.length) await configStore().put(key, JSON.stringify({ v: 1, products: entries }), Date.now());
    else await configStore().delete(key);
    return entries.length;
  } catch (error) {
    log.warn('could not rebuild the try-on shelf', { tenantId: ctx.tenantId, error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
}
