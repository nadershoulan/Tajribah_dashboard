/**
 * P1.6b — the sync schedule: one tick that reads the database (§13.6), not a repeatable
 * job per connection. Connections come and go; a per-connection timer outlives the
 * connection it was for, or is never created for a new one. A query cannot drift.
 *
 * Each tick does two things:
 *  1. **Due connections get a sync.** Active, and no sync queued, running, or finished
 *     within its interval — so a store whose sync keeps failing is retried once per
 *     interval, not once per tick.
 *  2. **Stale syncs are re-enqueued.** A sync `queued` or `running` whose row has not moved
 *     for `STALE_AFTER_MS` lost its queue job: the process died between committing the sync
 *     row and enqueueing (P1.6), or between a page and its continuation. Re-enqueueing is
 *     safe even if the old job is only slow — a page applies only on the cursor it was
 *     fetched for.
 */
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { storeConnections, syncJobs } from '@/db/schema';
import { enqueue } from '@/server/core/jobs/queue';
import { AppError } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';
import { systemContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { assertPlatformInPlan, createSyncIn, enqueueSync } from './service';

/** A sync row untouched this long has no job behind it. Pages commit in well under this. */
export const STALE_AFTER_MS = 15 * 60_000;
export const SCHEDULE_PERMISSIONS = ['connections:read', 'connections:write'] as const;

/** `stale`: syncs found stalled; each gets one re-enqueue per stall (a repeat returns the same job). */
export type ScheduleResult = { scheduled: number; stale: number };

/** Months of `sync_job_items` partitions kept ready ahead of time, this one included. */
export const PARTITION_MONTHS_AHEAD = 3;

/**
 * Make sure this month's and the next months' partitions exist (0002). Idempotent and
 * cheap, so every tick calls it: a missing month would put rows in the DEFAULT partition,
 * after which that month's partition can no longer be created.
 */
export async function ensureSyncItemPartitions(now = new Date()): Promise<string[]> {
  const db = unsafeAdminDb(); // DDL through a SECURITY DEFINER function granted to the admin role only
  const names: string[] = [];
  for (let i = 0; i < PARTITION_MONTHS_AHEAD; i++) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1)).toISOString().slice(0, 10);
    const result = await db.execute(sql`select ensure_sync_job_items_partition(${month}::date) as name`);
    // Drivers differ: some return the rows, some `{ rows }`.
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { name: string }[];
    names.push(rows[0].name);
  }
  return names;
}

export async function scheduleSyncs(now = new Date(), limit = 100): Promise<ScheduleResult> {
  await ensureSyncItemPartitions(now);
  const db = unsafeAdminDb(); // platform scheduling across tenants: ids and tenants only
  const due = await db
    .select({ id: storeConnections.id, tenantId: storeConnections.tenantId })
    .from(storeConnections)
    .where(and(
      eq(storeConnections.status, 'active'),
      sql`not exists (
        select 1 from ${syncJobs}
        where ${syncJobs.connectionId} = ${storeConnections.id}
          and ${syncJobs.tenantId} = ${storeConnections.tenantId}
          and (${syncJobs.status} in ('queued', 'running')
               or ${syncJobs.finishedAt} > ${now}::timestamptz - make_interval(mins => ${storeConnections.syncIntervalMinutes}))
      )`,
      sql`(${storeConnections.lastSyncAt} is null
           or ${storeConnections.lastSyncAt} <= ${now}::timestamptz - make_interval(mins => ${storeConnections.syncIntervalMinutes}))`,
    ))
    // Never-synced stores first: a new merchant is waiting on their catalogue.
    .orderBy(sql`${storeConnections.lastSyncAt} asc nulls first`)
    .limit(limit);

  let scheduled = 0;
  for (const { id, tenantId } of due) {
    try {
      const ctx = await systemContext({ tenantId, requestId: `schedule-${id}`, permissions: SCHEDULE_PERMISSIONS });
      await assertPlatformInPlan(ctx, id);
      const { job, fresh } = await withTenant(tenantId, (tx) => createSyncIn(ctx, tx, id, { type: 'incremental', triggeredBy: 'schedule' }));
      if (fresh) { await enqueueSync(tenantId, job.id); scheduled += 1; }
    } catch (error) {
      // T35: a platform no longer in the store's plan is skipped quietly — every tick would repeat it.
      if (error instanceof AppError && error.code === 'plan_required') continue;
      // One store (suspended, revoked in between) never stops the rest of the tick.
      log.warn('sync schedule skipped a connection', { connectionId: id, tenantId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const stale = await db
    .select({ id: syncJobs.id, tenantId: syncJobs.tenantId, updatedAt: syncJobs.updatedAt })
    .from(syncJobs)
    .where(and(inArray(syncJobs.status, ['queued', 'running']), lt(syncJobs.updatedAt, new Date(now.getTime() - STALE_AFTER_MS))))
    .orderBy(asc(syncJobs.updatedAt))
    .limit(limit);

  let staleCount = 0;
  for (const { id, tenantId, updatedAt } of stale) {
    // Keyed by the heartbeat it was stale at: one re-enqueue per stall, however many ticks see it.
    await enqueue({ queue: 'sync.products', tenantId, payload: { syncJobId: id }, dedupeKey: `sync:${id}:stale:${updatedAt.getTime()}` });
    staleCount += 1;
    log.warn('stale sync re-enqueued', { syncJobId: id, tenantId, idleMs: now.getTime() - updatedAt.getTime() });
  }

  if (scheduled || staleCount) log.info('sync schedule tick', { scheduled, stale: staleCount });
  return { scheduled, stale: staleCount };
}
