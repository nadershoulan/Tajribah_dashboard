/**
 * P3.2 — the AI job sweep, on the worker's scheduled tick. Two ways a job can be left behind:
 *
 *  - **Never dispatched**: the row was written, then the process died before the charge or the
 *    enqueue. Queued for over `UNDISPATCHED_MS` with no `dispatched` event → dispatch again
 *    (both steps are idempotent, so this can never charge twice or run twice).
 *  - **Abandoned**: `processing`, and nothing heard for `ABANDONED_MS` — no progress, no cost,
 *    no result. The worker died on its last attempt, or the provider never answered. Failed as
 *    `timed_out`, credits back. An executor that is still working keeps the job alive by
 *    reporting progress.
 *
 * Platform sweep across tenants: ids and tenants only; each change runs in its own tenant.
 */
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { aiJobEvents, aiJobs } from '@/db/schema';
import { log } from '@/server/core/observability/log';
import { failAbandoned, redispatch } from './lifecycle';

export const UNDISPATCHED_MS = 10 * 60 * 1000;
export const ABANDONED_MS = 60 * 60 * 1000;

export async function sweepAiJobs(now = new Date(), limit = 100): Promise<{ redispatched: number; abandoned: number }> {
  const db = unsafeAdminDb();
  const undispatched = await db.select({ id: aiJobs.id, tenantId: aiJobs.tenantId }).from(aiJobs)
    .where(and(
      eq(aiJobs.status, 'queued'),
      lt(aiJobs.queuedAt, new Date(now.getTime() - UNDISPATCHED_MS)),
      sql`not exists (select 1 from ${aiJobEvents} where ${aiJobEvents.jobId} = ${aiJobs.id} and ${aiJobEvents.event} = 'dispatched')`,
    ))
    .limit(limit);

  const quietSince = new Date(now.getTime() - ABANDONED_MS);
  const abandoned = await db.select({ id: aiJobs.id, tenantId: aiJobs.tenantId }).from(aiJobs)
    .where(and(
      eq(aiJobs.status, 'processing'),
      sql`not exists (select 1 from ${aiJobEvents} where ${aiJobEvents.jobId} = ${aiJobs.id} and ${gt(aiJobEvents.createdAt, quietSince)})`,
    ))
    .limit(limit);

  const result = { redispatched: 0, abandoned: 0 };
  for (const { id, tenantId } of undispatched) {
    try {
      if (await redispatch(tenantId, id, `ai-sweep-${id}`)) result.redispatched++;
    } catch (error) {
      log.error('ai job redispatch failed', { jobId: id, error: String(error) });
    }
  }
  for (const { id, tenantId } of abandoned) {
    try {
      if (await failAbandoned(tenantId, id, `ai-sweep-${id}`)) result.abandoned++;
    } catch (error) {
      log.error('ai job abandon failed', { jobId: id, error: String(error) });
    }
  }
  if (result.redispatched || result.abandoned) log.info('ai jobs swept', result);
  return result;
}
