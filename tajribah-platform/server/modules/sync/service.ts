/**
 * P1.6 — asking for a sync, and reading how it is going.
 *
 * One active sync per connection: asking again while one is queued or running returns
 * that one. The check and the insert happen under a lock on the connection row, so two
 * clicks (or a click and a webhook) cannot start two.
 *
 * The queue job is enqueued after the sync row commits. If the process dies in between,
 * the row stays `queued` with no job — the scheduler (P1.6b) re-enqueues stale syncs.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { storeConnections, syncJobs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import type { SyncProgress } from '@/lib/view-models';
import { record } from '@/server/core/audit/audit';
import { errors } from '@/server/core/errors/problem';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { enqueue } from '@/server/core/jobs/queue';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { ReconnectRequiredError } from '@/server/modules/connections/service';
import type { SyncJob } from './engine';

export type SyncRequest = {
  type?: 'full' | 'incremental';
  triggeredBy?: SyncJob['triggeredBy'];
};

/**
 * T35: the store's plan must include the connection's platform (Salla and Zid from Growth, Shopify
 * and WooCommerce from Pro). Checked **before** the sync's transaction by every caller — entitlements
 * are read on their own handle, which must not wait inside a transaction holding the store's locks.
 */
export async function assertPlatformInPlan(ctx: TenantContext, connectionId: string): Promise<void> {
  const connection = await ctx.db.findById(storeConnections, connectionId);
  // A product feed or file is on every plan (connections/feed.ts).
  if (connection && connection.provider !== 'feed') assertFeature(await entitlementsOf(ctx), connection.provider);
}

export async function requestSync(ctx: TenantContext, connectionId: string, request: SyncRequest = {}): Promise<SyncProgress> {
  ctx.require('connections:write');
  await assertPlatformInPlan(ctx, connectionId);
  const connection = await ctx.db.findById(storeConnections, connectionId);
  // A file's products change only when the file is uploaded again (connections/feed.ts): it is not re-read.
  if (connection?.provider === 'feed' && connection.settings?.kind === 'file') throw errors.conflict('these products came from a file — upload the file again to update them');
  const { job, fresh } = await withTenant(ctx.tenantId, (db) => createSyncIn(ctx, db, connectionId, request));
  if (fresh) await enqueueSync(ctx.tenantId, job.id);
  return toProgress(job);
}

/**
 * The sync row, inside the caller's transaction: the active one if there is one, else a new
 * `queued` one (`fresh`). The caller enqueues a fresh one with `enqueueSync` **after** its
 * transaction commits — a job for a row that rolled back would run against nothing.
 */
export async function createSyncIn(
  ctx: TenantContext, db: TenantDb, connectionId: string, request: SyncRequest = {},
): Promise<{ job: SyncJob; fresh: boolean }> {
  const triggeredBy = request.triggeredBy ?? 'user';
  const connection = await db.lockById(storeConnections, connectionId);
  if (connection.status !== 'active') throw new ReconnectRequiredError(connection.status);
  const active = await db.findOne(syncJobs, and(eq(syncJobs.connectionId, connectionId), inArray(syncJobs.status, ['queued', 'running'])));
  if (active) return { job: active, fresh: false };

  // Nothing to be incremental against yet: the first sync of a connection is full.
  const type = request.type === 'full' || !connection.lastSyncAt ? 'full' : 'incremental';
  const created = await db.insert(syncJobs, { id: uuidv7(), tenantId: ctx.tenantId, connectionId, type, status: 'queued', triggeredBy });
  await record(ctx, { action: 'sync', resourceType: 'store_connection', resourceId: connectionId, after: { syncJobId: created.id, type, status: 'queued', triggeredBy } }, db);
  return { job: created, fresh: true };
}

export async function enqueueSync(tenantId: string, syncJobId: string): Promise<void> {
  await enqueue({ queue: 'sync.products', tenantId, payload: { syncJobId }, dedupeKey: `sync:${syncJobId}:start` });
}

export async function syncProgress(ctx: TenantContext, syncJobId: string): Promise<SyncProgress> {
  ctx.require('connections:read');
  const job = await ctx.db.findById(syncJobs, syncJobId);
  if (!job) throw errors.notFound('sync');
  return toProgress(job);
}

/** The most recent sync of a connection, or null if it never synced. */
export async function latestSync(ctx: TenantContext, connectionId: string): Promise<SyncProgress | null> {
  ctx.require('connections:read');
  const [job] = await ctx.db.find(syncJobs, eq(syncJobs.connectionId, connectionId), { limit: 1, orderBy: desc(syncJobs.id) });
  return job ? toProgress(job) : null;
}

export function toProgress(job: SyncJob): SyncProgress {
  return {
    id: job.id,
    connectionId: job.connectionId,
    type: job.type,
    status: job.status,
    triggeredBy: job.triggeredBy,
    processed: job.processedItems,
    failed: job.failedItems,
    total: job.totalItems,
    percent: job.status === 'done' ? 100 : job.totalItems > 0 ? Math.min(100, Math.floor((job.processedItems / job.totalItems) * 100)) : null,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.error,
  };
}
