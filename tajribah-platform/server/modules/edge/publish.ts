/**
 * P1.15 — putting a product's viewer config where shops read it, and keeping it true.
 *
 *  - **Publish** is the merchant's act (AR settings → "Publish to the store", `ar:publish`): the
 *    product's config is built (`build.ts`), checked with the widget's parser, written to the
 *    config store under a new version, and recorded in `edge_configs` with its fingerprint.
 *    A product with nothing to open is refused with the reason, and nothing is written.
 *  - **Refresh** (`edge.publish-config` job) keeps what is already live true after a change the
 *    merchant made elsewhere: the product archived or deleted, its model replaced, its try-on
 *    changed, the store's colours, the store suspended or restored. It rebuilds; a product that no
 *    longer qualifies is **withdrawn** (its entry deleted — the widget then draws nothing, it fails
 *    closed); one whose config changed is rewritten; the same config is left alone. A withdrawn
 *    product that qualifies again (a store restored, a product back in the catalogue, AR switched
 *    back on) is published again: the merchant published it and never took that back. A product
 *    never published is never published by a refresh.
 *  - The status the screen shows compares what is live with what would be built now, so
 *    "shoppers see an older one" covers every source, not only the AR settings row.
 *
 * The config store is written before the row: if the row's write fails, the next refresh finds a
 * fingerprint that differs and writes again. A key that changed (the product's platform id) has
 * its old entry deleted, so one product never answers at two addresses.
 */
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { edgeConfigs, products } from '@/db/schema';
import type { Job } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import type { PublishResult } from '@/lib/contracts/ar-config';
import type { Publication } from '@/lib/view-models';
import { record } from '@/server/core/audit/audit';
import { entitlementsOf, type Entitlements } from '@/server/core/billing/entitlements';
import { configStore } from '@/server/core/edge/configs';
import { errors } from '@/server/core/errors/problem';
import { enqueue } from '@/server/core/jobs/queue';
import { log } from '@/server/core/observability/log';
import { currentScope } from '@/server/core/observability/scope';
import { systemContext, type TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { TenantDb } from '@/server/core/tenancy/tenant-db';
import { BLOCK_TEXT, buildEdgeConfig, type EdgeBlock, type EdgeBuild } from './build';

type EdgeRow = typeof edgeConfigs.$inferSelect;

/** What the AR settings screen shows about a product's live config (`outdated`: live, and what would be published now differs). */
export type EdgeStatus = PublishResult;

export const REFRESH_PERMISSIONS = ['products:read', 'models:read', 'ar:read', 'ar:publish', 'tryon:read', 'settings:read'] as const;

export async function publishProduct(ctx: TenantContext, productId: string): Promise<EdgeStatus> {
  ctx.require('ar:publish');
  const product = await ctx.db.findById(products, productId);
  if (!product || product.deletedAt) throw errors.notFound('product');
  const build = await buildEdgeConfig(ctx, productId, await entitlementsOf(ctx));
  if (!build.ok) throw errors.conflict(`cannot publish: ${BLOCK_TEXT[build.reason]}`);
  const row = await write(ctx, productId, build, await rowOf(ctx, productId), 'user');
  return { version: row.version, publishedAt: row.publishedAt!.toISOString(), outdated: false };
}

/**
 * T40 — the merchant takes a product off the shop ("Remove from the store"). Unlike a withdrawal,
 * this is their choice: the key is cleared, so no refresh brings it back; publishing again does.
 */
export async function unpublishProduct(ctx: TenantContext, productId: string): Promise<EdgeStatus> {
  ctx.require('ar:publish');
  const row = await rowOf(ctx, productId);
  if (!row?.key) throw errors.conflict('this product is not published');
  await takeDown(ctx, row, 'user', 'removed by the merchant');
  return { version: 0, publishedAt: null, outdated: false };
}

/**
 * T40 — the store uninstalled our app: every published product that came from that connection
 * leaves the shop at once (the website's promise), as if the merchant had removed each one.
 * Called after the webhook's transaction commits.
 */
export async function takeDownConnection(tenantId: string, connectionId: string, requestId: string): Promise<number> {
  const db = TenantDb.for(tenantId);
  const own = await db.find(products, eq(products.connectionId, connectionId), { limit: 10_000 });
  if (own.length === 0) return 0;
  const rows = await db.find(edgeConfigs, and(inArray(edgeConfigs.productId, own.map((p) => p.id)), isNotNull(edgeConfigs.key)), { limit: own.length });
  if (rows.length === 0) return 0;
  const ctx = await systemContext({ tenantId, requestId, permissions: REFRESH_PERMISSIONS, evenIfSuspended: true });
  for (const row of rows) await takeDown(ctx, row, 'system', 'the app was uninstalled from the store');
  return rows.length;
}

export type RefreshOutcome = 'never_published' | 'unchanged' | 'rewritten' | 'withdrawn';

/** Rebuild one published product's config and write, withdraw or leave it. Idempotent. */
export async function refreshProduct(ctx: TenantContext, productId: string, entitlements: Entitlements): Promise<RefreshOutcome> {
  const row = await rowOf(ctx, productId);
  if (!row?.key) return 'never_published';
  const build = await buildEdgeConfig(ctx, productId, entitlements);
  if (!build.ok) {
    if (row.withdrawnAt) return 'unchanged';
    await withdraw(ctx, row, build.reason);
    return 'withdrawn';
  }
  if (!row.withdrawnAt && build.key === row.key && build.fingerprint === row.fingerprint) return 'unchanged';
  await write(ctx, productId, build, row, 'system');
  return 'rewritten';
}

/** Queue a refresh — of one product, or (no product) of every product the store has published. */
export async function enqueueEdgeRefresh(tenantId: string, productId?: string | null): Promise<void> {
  // No dedupe key: the queue's keys are unique forever, and a second refresh is a cheap no-op.
  await enqueue({ queue: 'edge.publish-config', tenantId, priority: 10, payload: productId ? { productId } : {} });
}

/**
 * After a change to one product (called outside any transaction): bring its live config up to date
 * now, so a shopper never meets a config naming a picture about to be deleted. Cheap when the
 * product is not live (one read). A failure never fails the merchant's change: it is logged and
 * retried as a job.
 */
export async function keepLive(tenantId: string, productId: string): Promise<void> {
  try {
    await refreshStore(tenantId, productId, currentScope()?.requestId ?? 'edge-keep-live');
  } catch (error) {
    log.warn('edge refresh failed — queued to retry', { tenantId, productId, error: error instanceof Error ? error.message : String(error) });
    await enqueueEdgeRefresh(tenantId, productId);
  }
}

/**
 * T36: how long a file a live config named is kept after it is replaced — the host's cache (60 s),
 * KV's own propagation (up to about 60 s) and a wide margin. Shoppers holding the older config
 * must still find its pictures.
 */
export const LIVE_GRACE_MS = 10 * 60_000;

/** Whether shoppers may be holding a config for this product right now. */
export async function isLive(tenantId: string, productId: string): Promise<boolean> {
  const row = await TenantDb.for(tenantId).findOne(edgeConfigs, eq(edgeConfigs.productId, productId));
  if (!row) return false;
  // Taken down (withdrawn or removed) within the grace period counts too: a cached copy may still be out there.
  if (row.withdrawnAt) return Date.now() - row.withdrawnAt.getTime() < LIVE_GRACE_MS;
  return !!row.key;
}

export async function handleEdgeJob(job: Job): Promise<void> {
  if (!job.tenantId) throw new Error(`edge job ${job.id} has no tenant`);
  const productId = (job.payload as { productId?: unknown } | null)?.productId;
  await refreshStore(job.tenantId, typeof productId === 'string' ? productId : null, currentScope()?.requestId ?? `job-${job.id}`);
}

/** The refresh a job runs: one product, or every published one (live or withdrawn). Returns each product's outcome. */
export async function refreshStore(tenantId: string, productId: string | null, requestId: string): Promise<Map<string, RefreshOutcome>> {
  const outcomes = new Map<string, RefreshOutcome>();
  const published = await TenantDb.for(tenantId).find(edgeConfigs,
    productId ? and(eq(edgeConfigs.productId, productId), isNotNull(edgeConfigs.key)) : isNotNull(edgeConfigs.key), { limit: 5000 });
  if (published.length === 0) { // the usual case after a change: nothing published, one read
    if (productId) outcomes.set(productId, 'never_published');
    return outcomes;
  }
  // A suspended store's refresh can only withdraw: the builder refuses it before anything else.
  const ctx = await systemContext({ tenantId, requestId, permissions: REFRESH_PERMISSIONS, evenIfSuspended: true });
  const entitlements = await entitlementsOf(ctx);
  for (const row of published) outcomes.set(row.productId, await refreshProduct(ctx, row.productId, entitlements));
  return outcomes;
}

/**
 * The status of each listed product. Only live products are rebuilt (to compare fingerprints);
 * the rest are "not published" without any work.
 */
export async function edgeStatuses(ctx: TenantContext, productIds: readonly string[]): Promise<Map<string, EdgeStatus>> {
  const out = new Map<string, EdgeStatus>();
  if (productIds.length === 0) return out;
  const rows = await ctx.db.find(edgeConfigs, and(inArray(edgeConfigs.productId, [...productIds]), isNotNull(edgeConfigs.key), isNull(edgeConfigs.withdrawnAt)), { limit: productIds.length });
  const entitlements = rows.length ? await entitlementsOf(ctx) : null;
  for (const row of rows) {
    const build = await buildEdgeConfig(ctx, row.productId, entitlements!);
    out.set(row.productId, {
      version: row.version, publishedAt: row.publishedAt?.toISOString() ?? null,
      outdated: !build.ok || build.key !== row.key || build.fingerprint !== row.fingerprint,
    });
  }
  return out;
}

/**
 * T37: which product a page's product ref names, and whether its button is live — for the install
 * checker. The ref is what the config key is built from: the platform's id, or ours for a product
 * made in the dashboard (`externalId ?? id`, exactly as `build.ts`).
 */
export async function publicationOf(ctx: TenantContext, productRef: string): Promise<Publication | null> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productRef);
  const found = await ctx.db.find(products, and(isNull(products.deletedAt),
    uuid ? or(eq(products.externalId, productRef), and(isNull(products.externalId), eq(products.id, productRef))) : eq(products.externalId, productRef)), { limit: 2 });
  const product = found[0];
  if (!product) return null;
  const row = await rowOf(ctx, product.id);
  const state = !row?.key ? 'not_published' : row.withdrawnAt ? 'withdrawn' : 'live';
  return { productId: product.id, name: product.name, nameAr: product.nameAr, state, version: state === 'live' ? row!.version : 0 };
}

async function rowOf(ctx: TenantContext, productId: string): Promise<EdgeRow | null> {
  return ctx.db.findOne(edgeConfigs, eq(edgeConfigs.productId, productId));
}

async function write(ctx: TenantContext, productId: string, build: Extract<EdgeBuild, { ok: true }>, row: EdgeRow | null, actor: 'user' | 'system'): Promise<EdgeRow> {
  const now = new Date();
  await configStore().put(build.key, build.body, (row?.version ?? 0) + 1);
  if (row?.key && row.key !== build.key && !row.withdrawnAt) await configStore().delete(row.key);
  return withTenant(ctx.tenantId, async (db) => {
    // The version is counted under the row's lock, so two publishes at once are 2 and 3, not 2 and 2.
    const locked = row ? await db.lockById(edgeConfigs, row.id) : null;
    const version = (locked?.version ?? 0) + 1;
    const values = { key: build.key, version, fingerprint: build.fingerprint, publishedAt: now, withdrawnAt: null, updatedAt: now };
    const saved = locked
      ? await db.updateById(edgeConfigs, locked.id, values)
      : await db.insert(edgeConfigs, { id: uuidv7(), tenantId: ctx.tenantId, productId, ...values });
    await record(ctx, {
      action: 'publish', resourceType: 'edge_config', resourceId: productId, actorType: actor,
      before: locked ? { version: locked.version, key: locked.key } : undefined, after: { version, key: build.key },
    }, db);
    return saved;
  });
}

async function withdraw(ctx: TenantContext, row: EdgeRow, reason: EdgeBlock): Promise<void> {
  await configStore().delete(row.key!);
  const now = new Date();
  await withTenant(ctx.tenantId, async (db) => {
    // The key stays: it is where the product is published again if it qualifies again.
    await db.updateById(edgeConfigs, row.id, { withdrawnAt: now, updatedAt: now });
    await record(ctx, {
      action: 'unpublish', resourceType: 'edge_config', resourceId: row.productId, actorType: 'system',
      before: { version: row.version, key: row.key }, after: { reason },
    }, db);
  });
}

/** T40: the entry deleted and the key cleared — nothing brings it back but publishing again. */
async function takeDown(ctx: TenantContext, row: EdgeRow, actor: 'user' | 'system', reason: string): Promise<void> {
  await configStore().delete(row.key!); // already gone after a withdrawal; deleting again is harmless
  const now = new Date();
  await withTenant(ctx.tenantId, async (db) => {
    await db.updateById(edgeConfigs, row.id, { key: null, withdrawnAt: now, updatedAt: now });
    await record(ctx, {
      action: 'unpublish', resourceType: 'edge_config', resourceId: row.productId, actorType: actor,
      before: { version: row.version, key: row.key }, after: { reason },
    }, db);
  });
}
