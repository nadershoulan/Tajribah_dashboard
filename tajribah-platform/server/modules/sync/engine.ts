/**
 * P1.6 — the sync engine: a store's catalogue into `products`, one page at a time.
 *
 *  - **One page, one transaction.** The products of a page, its `sync_job_items` rows, and
 *    the job's cursor and counters commit together. A crash loses at most the page in
 *    flight, and the next run fetches that page again from the stored cursor — resumable,
 *    not restartable.
 *  - **Idempotent.** A product is found by `(connection, external_id)` before it is
 *    written, and a page is only applied if the job's cursor is still the one the page was
 *    fetched with (checked under a row lock). Two runs of the same job — a duplicate
 *    delivery, a retry racing a slow first attempt — cannot apply one page twice.
 *  - **The store owns only what it syncs.** Name, SKU, price, description, images, status.
 *    Dimensions, AR switches and product type are the merchant's: a size the source gives (a feed's
 *    product_width…) only fills an empty one (T72), never overwrites it.
 *  - **Full sync archives what the store no longer has** — unless that would archive most
 *    of the catalogue, which looks like a store API fault, not a merchant deleting 90% of
 *    their products. Then nothing is archived and the connection says why.
 *  - **The whole catalogue comes in** (T72): the plan's product limit counts products shown in 3D or
 *    the try-on, which the merchant switches on one by one — never the rows a sync writes.
 *
 * Audit: a sync is one `sync` row on the connection when it finishes, with its counts.
 * The per-product trail is `sync_job_items` — 10,000 audit rows per import would bury
 * every change a person made.
 */
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { categories, products, storeConnections, syncJobItems, syncJobs, type Product } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { connectorFor, TokenRevokedError, type ExternalProduct, type Page } from '@/server/connectors/types';
import { record } from '@/server/core/audit/audit';
import { log } from '@/server/core/observability/log';
import { systemContext, type TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { accessTokenFor, ReconnectRequiredError, revokeIn } from '@/server/modules/connections/service';
import { notifyIn } from '@/server/modules/notifications/service';

export type SyncJob = typeof syncJobs.$inferSelect;
export type StepResult = 'done' | 'more' | 'failed' | 'skipped';

/** What a sync job may do — and nothing else. */
export const SYNC_PERMISSIONS = ['products:read', 'products:write', 'connections:read'] as const;

/** Pages per run before handing over to a continuation job, so one tick never runs long. */
export const PAGES_PER_RUN = 20;

/**
 * Incremental syncs ask for changes since the last sync *started*, minus this overlap: the
 * store's clock is not ours, and re-reading a few unchanged products costs a skip each.
 */
export const SINCE_OVERLAP_MS = 10 * 60_000;

/** A full sync that would archive more than this share of the live catalogue is refused. */
export const ARCHIVE_GUARD = 0.5;

/** `price_minor` is a Postgres `integer`. */
const MAX_PRICE_MINOR = 2_147_483_647;

export async function runSyncStep(input: {
  tenantId: string;
  syncJobId: string;
  requestId: string;
  maxPages?: number;
  now?: () => Date;
}): Promise<{ result: StepResult; job: SyncJob | null }> {
  const now = input.now ?? (() => new Date());
  const ctx = await systemContext({ tenantId: input.tenantId, requestId: input.requestId, permissions: SYNC_PERMISSIONS });
  let job = await begin(ctx, input.syncJobId, now());
  if (!job) return { result: 'skipped', job: null };

  const connection = await ctx.db.requireById(storeConnections, job.connectionId);
  const connector = connectorFor(connection.provider);
  const since = job.type === 'incremental' && connection.lastSyncAt
    ? new Date(connection.lastSyncAt.getTime() - SINCE_OVERLAP_MS)
    : null;

  for (let page = 0; page < (input.maxPages ?? PAGES_PER_RUN); page++) {
    let token: string;
    try {
      token = await accessTokenFor(ctx, connection.id);
    } catch (error) {
      if (!(error instanceof ReconnectRequiredError)) throw error;
      return { result: 'failed', job: await markSyncFailed(ctx, job.id, error.message, now()) };
    }
    const cursor = job.cursor;
    let fetched: Awaited<ReturnType<typeof connector.listProducts>>;
    try {
      fetched = await connector.listProducts(token, cursor, since);
    } catch (error) {
      if (!(error instanceof TokenRevokedError)) throw error;
      // The store refused the token while listing (WooCommerce keys never refresh, so this is where
      // a revoked key shows): the connection needs the merchant, not another retry every hour.
      await withTenant(ctx.tenantId, (db) => revokeIn(ctx, db, connection.id, 'the store refused the keys — reconnect it'));
      return { result: 'failed', job: await markSyncFailed(ctx, job.id, 'the store refused access — reconnect it', now()) };
    }
    const applied = await applyPage(ctx, job.id, cursor, fetched, now());
    if (!applied) return { result: 'skipped', job: null }; // another run got there first
    job = applied;
    if (job.status === 'done') return { result: 'done', job };
  }
  return { result: 'more', job };
}

/** Mark a sync failed for good. A finished job is left alone. */
export async function markSyncFailed(ctx: TenantContext, syncJobId: string, message: string, now = new Date()): Promise<SyncJob | null> {
  return withTenant(ctx.tenantId, async (db) => {
    const job = await db.lockById(syncJobs, syncJobId);
    if (job.status !== 'queued' && job.status !== 'running') return null;
    const failed = await db.updateById(syncJobs, syncJobId, { status: 'failed', error: message, finishedAt: now });
    await db.updateById(storeConnections, job.connectionId, { lastError: `sync failed: ${message}` });
    await record(ctx, { action: 'sync', resourceType: 'store_connection', resourceId: job.connectionId, after: { syncJobId, status: 'failed', error: message } }, db);
    await notifyIn(db, {
      type: 'sync.failed', permission: 'connections:read', level: 'error', href: '/dashboard/connections',
      title: { ar: 'فشلت مزامنة متجرك', en: 'Your store sync failed' }, body: { ar: message, en: message },
    });
    log.warn('sync failed', { syncJobId, connectionId: job.connectionId, error: message });
    return failed;
  });
}

// ------------------------------------------------------------------ steps

/** Claim the job for running. Null when there is nothing to do (finished, cancelled). */
async function begin(ctx: TenantContext, syncJobId: string, now: Date): Promise<SyncJob | null> {
  return withTenant(ctx.tenantId, async (db) => {
    const job = await db.findById(syncJobs, syncJobId);
    if (!job) return null;
    const locked = await db.lockById(syncJobs, syncJobId);
    if (locked.status === 'running') return locked;
    if (locked.status !== 'queued') return null;
    return db.updateById(syncJobs, syncJobId, { status: 'running', startedAt: now });
  });
}

async function applyPage(
  ctx: TenantContext, syncJobId: string, cursor: string | null, page: Page<ExternalProduct>, now: Date,
): Promise<SyncJob | null> {
  return withTenant(ctx.tenantId, async (db) => {
    const job = await db.lockById(syncJobs, syncJobId);
    if (job.status !== 'running' || job.cursor !== cursor) return null;

    const failed = await applyItems(db, job, page.items, now);
    const processed = job.processedItems + page.items.length;
    const progress = {
      cursor: page.next,
      processedItems: processed,
      failedItems: job.failedItems + failed,
      totalItems: page.total ?? Math.max(job.totalItems, processed),
    };
    if (page.next !== null) return db.updateById(syncJobs, syncJobId, progress);
    return finish(ctx, db, job, progress, now);
  });
}

/** Apply one page's items. Returns how many failed. */
async function applyItems(db: TenantDb, job: SyncJob, items: ExternalProduct[], now: Date): Promise<number> {
  if (items.length === 0) return 0;
  const ids = [...new Set(items.map((i) => i.externalId).filter(Boolean))];
  const existing = ids.length
    ? await db.find(products, and(eq(products.connectionId, job.connectionId), inArray(products.externalId, ids)), { limit: ids.length })
    : [];
  const byExternalId = new Map(existing.map((p) => [p.externalId!, p]));
  const categoryIds = await categoriesFor(db, items, now);
  // T77: the store's category follows the source on every sync (it is the store's, like the name);
  // a connector that does not report one (undefined) leaves the product's alone.
  const categoryOf = (item: ExternalProduct) => (item.category === undefined ? undefined : item.category ? categoryIds.get(categorySlug(item.category)) ?? null : null);

  type ItemRow = { externalId: string; productId?: string; action: 'created' | 'updated' | 'skipped' | 'failed'; error?: string };
  const rows: ItemRow[] = [];
  const inserts: (typeof products.$inferInsert)[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const problem = invalid(item);
    if (problem) { rows.push({ externalId: item.externalId || '(none)', action: 'failed', error: problem }); continue; }
    if (seen.has(item.externalId)) { rows.push({ externalId: item.externalId, action: 'skipped', error: 'listed twice on one page' }); continue; }
    seen.add(item.externalId);

    const fields = storeFields(item);
    const current = byExternalId.get(item.externalId);
    if (!current) {
      const id = uuidv7();
      const categoryId = categoryOf(item);
      inserts.push({ id, tenantId: db.tenantId, connectionId: job.connectionId, externalId: item.externalId, ...fields, ...(item.dimensions ? { dimensions: item.dimensions } : {}), ...(item.productType ? { productType: item.productType } : {}), ...(categoryId ? { categoryId } : {}), syncedAt: now });
      rows.push({ externalId: item.externalId, productId: id, action: 'created' });
    } else if (current.deletedAt) {
      rows.push({ externalId: item.externalId, productId: current.id, action: 'skipped', error: 'deleted in Tajribah' });
    } else if (unchanged(current, fields) && !(item.dimensions && !current.dimensions) && !(item.productType && current.productType === 'other') && (categoryOf(item) === undefined || categoryOf(item) === current.categoryId)) {
      rows.push({ externalId: item.externalId, productId: current.id, action: 'skipped' });
    } else {
      // T72: a size from the source fills an empty one only — once set, the size is the merchant's. T77: so does a type.
      await db.updateById(products, current.id, {
        ...fields, ...(item.dimensions && !current.dimensions ? { dimensions: item.dimensions } : {}),
        ...(item.productType && current.productType === 'other' ? { productType: item.productType } : {}),
        ...(categoryOf(item) !== undefined ? { categoryId: categoryOf(item) } : {}), syncedAt: now,
      });
      rows.push({ externalId: item.externalId, productId: current.id, action: 'updated' });
    }
  }

  if (inserts.length) await db.insert(products, inserts);
  await db.insert(syncJobItems, rows.map((r) => ({
    id: uuidv7(), tenantId: db.tenantId, syncJobId: job.id,
    externalId: r.externalId, productId: r.productId ?? null, action: r.action, error: r.error ?? null,
  })));
  return rows.filter((r) => r.action === 'failed').length;
}

/** T77: one category per store per name — "ساعات نسائية" and " ساعات  نسائية " are one. */
export const categorySlug = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 100);

/** The page's store categories as rows of this store's `categories` (found, or added): slug → id. */
async function categoriesFor(db: TenantDb, items: ExternalProduct[], now: Date): Promise<Map<string, string>> {
  const named = new Map<string, string>();
  for (const item of items) if (item.category?.trim()) named.set(categorySlug(item.category), item.category.trim().slice(0, 100));
  if (named.size === 0) return new Map();
  const found = await db.find(categories, inArray(categories.slug, [...named.keys()]), { limit: named.size });
  const ids = new Map(found.map((c) => [c.slug, c.id]));
  const missing = [...named].filter(([slug]) => !ids.has(slug));
  if (missing.length) {
    const rows = missing.map(([slug, name]) => ({ id: uuidv7(), tenantId: db.tenantId, slug, name, nameAr: /[\u0600-\u06FF]/.test(name) ? name : null, createdAt: now, updatedAt: now }));
    await db.insert(categories, rows);
    for (const r of rows) ids.set(r.slug, r.id);
  }
  return ids;
}

/** The last page: archive what a full sync did not see, stamp the connection, record it. */
async function finish(
  ctx: TenantContext, db: TenantDb, job: SyncJob, progress: Partial<SyncJob>, now: Date,
): Promise<SyncJob> {
  let archived = 0;
  let warning: string | null = null;
  if (job.type === 'full') {
    const notSeen = and(
      eq(products.connectionId, job.connectionId),
      isNull(products.deletedAt),
      ne(products.status, 'archived'),
      sql`${products.externalId} not in (select ${syncJobItems.externalId} from ${syncJobItems} where ${syncJobItems.syncJobId} = ${job.id})`,
    )!;
    const missing = await db.count(products, notSeen);
    const live = await db.count(products, and(eq(products.connectionId, job.connectionId), isNull(products.deletedAt), ne(products.status, 'archived')));
    if (missing > 0 && missing > live * ARCHIVE_GUARD) {
      warning = `the store listed ${live - missing} of ${live} products — nothing archived; check the store and sync again`;
      log.warn('sync archive guard', { syncJobId: job.id, missing, live });
    } else if (missing > 0) {
      archived = (await db.update(products, notSeen, { status: 'archived', arEnabled: false, syncedAt: now })).length;
    }
  }

  const count = (action: 'created' | 'updated' | 'skipped' | 'failed') =>
    db.count(syncJobItems, and(eq(syncJobItems.syncJobId, job.id), eq(syncJobItems.action, action)));
  const [created, updated, skipped, failed] = await Promise.all([count('created'), count('updated'), count('skipped'), count('failed')]);

  // The next incremental asks for changes since this one *started*.
  await db.updateById(storeConnections, job.connectionId, { lastSyncAt: job.startedAt ?? now, lastError: warning });
  const done = await db.updateById(syncJobs, job.id, { ...progress, status: 'done', finishedAt: now, error: warning });
  await record(ctx, {
    action: 'sync', resourceType: 'store_connection', resourceId: job.connectionId,
    after: { syncJobId: job.id, type: job.type, status: 'done', created, updated, skipped, failed, archived },
  }, db);
  if (warning) {
    await notifyIn(db, {
      type: 'sync.archive_guard', permission: 'connections:read', level: 'warning', href: '/dashboard/connections',
      title: { ar: 'المزامنة لم تؤرشف أي منتج', en: 'The sync archived nothing' },
      body: { ar: 'متجرك أظهر عددًا أقل بكثير من المنتجات. تأكد من المتجر ثم زامن مجددًا.', en: warning },
    });
  }
  log.info('sync finished', { syncJobId: job.id, type: job.type, created, updated, skipped, failed, archived });
  return done;
}

// ------------------------------------------------------------------ mapping

type StoreFields = Pick<Product, 'name' | 'nameAr' | 'sku' | 'description' | 'priceMinor' | 'currency' | 'images' | 'status'>;

function storeFields(item: ExternalProduct): StoreFields {
  return {
    name: item.name.trim(),
    nameAr: item.nameAr?.trim() || null,
    sku: item.sku?.trim() || null,
    description: item.description,
    priceMinor: item.priceMinor,
    currency: item.currency,
    images: item.images,
    status: item.status,
  };
}

function unchanged(current: Product, fields: StoreFields): boolean {
  return current.name === fields.name && current.nameAr === fields.nameAr && current.sku === fields.sku
    && current.description === fields.description && current.priceMinor === fields.priceMinor
    && current.currency === fields.currency && current.status === fields.status
    && JSON.stringify(current.images ?? []) === JSON.stringify(fields.images ?? []);
}

/** Why the store's product cannot be stored, or null. */
function invalid(item: ExternalProduct): string | null {
  if (!item.externalId) return 'the store sent a product without an id';
  if (!item.name?.trim()) return 'no name';
  if (item.priceMinor !== null && (!Number.isInteger(item.priceMinor) || item.priceMinor < 0)) return 'price must be whole minor units, 0 or more';
  // Past the column's range the insert fails, which would fail the whole page on every retry.
  if (item.priceMinor !== null && item.priceMinor > MAX_PRICE_MINOR) return 'price is too large';
  if (!/^[A-Z]{3}$/.test(item.currency)) return `currency "${item.currency}" is not an ISO 4217 code`;
  return null;
}
