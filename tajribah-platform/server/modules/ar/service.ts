/**
 * P1.21 — AR button and viewer settings, per product.
 *
 * A product without a saved row shows the defaults (`DEFAULT_AR_CONFIG`) and a placement that
 * fits its type; nothing is written until the merchant saves. Saving is audited. Publishing —
 * the product's whole config, to the store shops read — is `edge/publish.ts` (P1.15); the view
 * carries its status: the version shoppers see, and whether what would be published now differs.
 */
import { kindOf } from '@/lib/tryon';
import { and, desc, eq, ilike, inArray, isNull, ne, notInArray, or } from 'drizzle-orm';
import { arConfigs, edgeConfigs, hostedPages, products, tryonConfigs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { ArConfigInput, DEFAULT_AR_CONFIG, defaultLabelsFor, placementErrors, placementsFor, type ArConfigPage, type ArConfigView } from '@/lib/contracts/ar-config';
import { auditedInsert, auditedUpdate } from '@/server/core/audit/audit';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { edgeStatuses, type EdgeStatus } from '@/server/modules/edge/publish';
import { customHostOf, hostedPageViewOf } from '@/server/modules/hosted-pages/view';

type Product = typeof products.$inferSelect;
type Config = typeof arConfigs.$inferSelect;

const likeEscape = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listArConfigs(ctx: TenantContext): Promise<ArConfigView[]> {
  return (await listArConfigPage(ctx, { page: 1, pageSize: 500 })).configs;
}

/**
 * T73 — one numbered page of the products, those already set up first (3D on, a try-on, saved
 * settings, or published — newest first), then the rest of the catalogue, newest first; `q` searches
 * the name, Arabic name and SKU. A store of thousands of products no longer hides the ones that matter.
 */
export async function listArConfigPage(ctx: TenantContext, query: { page?: number; pageSize?: number; q?: string }): Promise<ArConfigPage> {
  ctx.require('ar:read');
  const pageSize = Math.min(Math.max(1, query.pageSize ?? 50), 500);
  const search = query.q?.trim()
    ? or(ilike(products.name, likeEscape(query.q.trim())), ilike(products.nameAr, likeEscape(query.q.trim())), ilike(products.sku, likeEscape(query.q.trim())))
    : undefined;
  const listed = and(isNull(products.deletedAt), ne(products.status, 'archived'), search);
  const [saved, tryons, edges, shown] = await Promise.all([
    ctx.db.find(arConfigs, undefined, { limit: 100_000 }),
    ctx.db.find(tryonConfigs, undefined, { limit: 100_000 }),
    ctx.db.find(edgeConfigs, undefined, { limit: 100_000 }),
    ctx.db.find(products, and(listed, eq(products.arEnabled, true)), { limit: 100_000 }),
  ]);
  const setUpIds = [...new Set([...saved, ...tryons, ...edges].map((r) => r.productId).concat(shown.map((p) => p.id)))];
  const setUp = setUpIds.length ? await ctx.db.find(products, and(listed, inArray(products.id, setUpIds)), { limit: setUpIds.length, orderBy: desc(products.id) }) : [];
  const rest = and(listed, setUp.length ? notInArray(products.id, setUp.map((p) => p.id)) : undefined);
  const total = setUp.length + await ctx.db.count(products, rest);
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1)), Math.max(1, Math.ceil(total / pageSize)));
  const start = (page - 1) * pageSize;
  const first = setUp.slice(start, start + pageSize);
  const more = pageSize - first.length;
  const rows = more > 0
    ? [...first, ...await ctx.db.find(products, rest, { limit: more, offset: Math.max(0, start - setUp.length), orderBy: desc(products.id) })]
    : first;
  return { configs: await viewsOf(ctx, rows), total, page, pageSize };
}

async function viewsOf(ctx: TenantContext, rows: Product[]): Promise<ArConfigView[]> {
  const configs = rows.length ? await ctx.db.find(arConfigs, inArray(arConfigs.productId, rows.map((p) => p.id)), { limit: 500 }) : [];
  const live = await edgeStatuses(ctx, rows.map((p) => p.id));
  const pages = await pagesOf(ctx, rows);
  // T90: whether each product's try-on is complete — the way into the shop while 3D models are version 2
  const tryons = rows.length ? await ctx.db.find(tryonConfigs, inArray(tryonConfigs.productId, rows.map((p) => p.id)), { limit: 500 }) : [];
  const tryonOf = (p: Product) => {
    const c = tryons.find((x) => x.productId === p.id) ?? null;
    const kind = kindOf(p.productType, c?.category);
    if (!kind) return null;
    return { ready: !!c?.wornKey && (kind !== 'watch' || !!c.flatKey) && c.caseTenthsMm != null };
  };
  return rows.map((p) => ({ ...withEdge(arViewOf(p, configs.find((c) => c.productId === p.id) ?? null), live.get(p.id)), page: pages.get(p.id)!, tryon: tryonOf(p) }));
}

/** P1.19: each product's own page, from its row (none: on, no link) and whether it is published. */
async function pagesOf(ctx: TenantContext, rows: Product[]) {
  const ids = rows.map((p) => p.id);
  const [pages, edges, customHost] = ids.length
    ? await Promise.all([
      ctx.db.find(hostedPages, inArray(hostedPages.productId, ids), { limit: ids.length }),
      ctx.db.find(edgeConfigs, inArray(edgeConfigs.productId, ids), { limit: ids.length }),
      customHostOf(ctx),
    ])
    : [[], [], null];
  return new Map(rows.map((p) => [p.id, hostedPageViewOf(ctx.tenant.slug, p, pages.find((r) => r.productId === p.id) ?? null, edges.find((r) => r.productId === p.id), customHost)]));
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
  return { ...withEdge(arViewOf(product, saved), (await edgeStatuses(ctx, [productId])).get(productId)), page: (await pagesOf(ctx, [product])).get(productId)! };
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
    page: null,
  };
}
