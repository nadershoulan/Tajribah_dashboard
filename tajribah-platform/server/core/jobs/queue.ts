/**
 * P0.13 — the job framework.
 *
 * Jobs are rows first and a transport second (T6): the merchant UI has to show sync and
 * generation progress, so job state must be queryable whatever delivers the work.
 *
 * Claiming is one statement: `FOR UPDATE SKIP LOCKED` takes row locks on the candidates,
 * a window function trims each tenant to its share, and the UPDATE marks them claimed.
 * §13.6 — do not add a `processing` status and hope two workers never read at once; the
 * lock is what makes concurrent workers safe, and doing it in one statement is what keeps
 * it correct when there are twenty of them.
 *
 * **Queue fairness is not optional.** One merchant importing 50,000 products must not stall
 * everyone else, so a single tenant may hold at most `FAIR_SHARE` of any claim batch.
 *
 * §13.5: the worker is a process. Its entry point is `server/worker/main.ts`, created in
 * the same package as this file — not "later".
 */
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { currentScope } from '../observability/scope';
import { jobs, type Job, type JobState } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';

/** No tenant may occupy more than this fraction of a claim batch (§8). */
export const FAIR_SHARE = 0.2;

export type QueueName =
  | 'sync.products' | 'sync.inventory' | 'sync.orders'
  | 'ai.generate-3d' | 'ai.postprocess' | 'ai.embed'
  | 'edge.publish-config'
  | 'tryon.quality'
  | 'storage.delete-later'
  | 'notify.email' | 'notify.sms'
  | 'analytics.rollup' | 'system.cleanup';

export type EnqueueInput = {
  queue: QueueName;
  /** Null only for platform work (rollups, cleanup). Tenant work always sets it. */
  tenantId?: string | null;
  payload?: Record<string, unknown>;
  /** Lower runs first. Merchant-visible work (`edge.publish-config`) belongs near 10. */
  priority?: number;
  runAfter?: Date;
  maxAttempts?: number;
  /** Same key, same job. Makes an enqueue from a scheduler or a webhook idempotent. */
  dedupeKey?: string;
};

export async function enqueue(input: EnqueueInput): Promise<Job> {
  const db = unsafeAdminDb(); // the queue is platform infrastructure, not tenant data
  const row = {
    id: uuidv7(),
    queue: input.queue,
    tenantId: input.tenantId ?? null,
    // The request that asked for this job, so its log lines can be followed into the worker.
    payload: { ...(currentScope()?.requestId ? { _requestId: currentScope()!.requestId } : {}), ...(input.payload ?? {}) },
    state: 'queued' as JobState,
    priority: input.priority ?? 100,
    runAfter: input.runAfter ?? new Date(),
    maxAttempts: input.maxAttempts ?? 5,
    dedupeKey: input.dedupeKey ?? null,
  };

  if (!input.dedupeKey) {
    const [created] = await db.insert(jobs).values(row).returning();
    return created;
  }
  // The unique index decides, not a read first: two callers can both read "no job yet".
  // The loser inserts nothing and reads the winner's row, which has committed by then.
  const [created] = await db.insert(jobs).values(row).onConflictDoNothing({ target: jobs.dedupeKey }).returning();
  if (created) return created;
  const [existing] = await db.select().from(jobs).where(eq(jobs.dedupeKey, input.dedupeKey)).limit(1);
  return existing;
}

/**
 * Claim up to `limit` jobs for this worker, fairly.
 *
 * One statement, three steps: lock the free candidates (`skip locked`, so a row another
 * worker holds is passed over rather than waited on), trim each tenant to `FAIR_SHARE` of
 * the batch, then mark what is left claimed. Nothing between the read and the write, so two
 * workers can never take the same job.
 */
export async function claim(input: {
  worker: string;
  queues?: QueueName[];
  limit?: number;
  now?: Date;
}): Promise<Job[]> {
  const db = unsafeAdminDb();
  const limit = input.limit ?? 10;
  const now = input.now ?? new Date();
  const cap = Math.max(1, Math.floor(limit * FAIR_SHARE));
  const queues = input.queues?.length ? input.queues : null;

  // Read wide, lock what is free, then trim per tenant. `coalesce(tenant_id, ...)` puts all
  // platform jobs in one partition so they cannot crowd out tenants either.
  const claimed = await db.execute(sql`
    with locked as (
      select id, tenant_id, priority, run_after
      from jobs
      where state = 'queued'
        and run_after <= ${now}
        ${queues ? sql`and queue = any(${sql.raw(`array[${queues.map((q) => `'${q}'`).join(',')}]`)})` : sql``}
      order by priority asc, run_after asc, id asc
      limit ${limit * 10}
      for update skip locked
    ),
    fair as (
      select id from (
        select id,
               row_number() over (
                 partition by coalesce(tenant_id::text, '~platform~')
                 order by priority asc, run_after asc, id asc
               ) as rn
        from locked
      ) ranked
      where rn <= ${cap}
      limit ${limit}
    )
    update jobs
       set state = 'claimed',
           claimed_by = ${input.worker},
           claimed_at = ${now},
           attempts = jobs.attempts + 1
     where id in (select id from fair)
    returning *
  `);

  return rowsOf<Job>(claimed).map(fromRow);
}

/** Drivers disagree about whether `execute` returns rows directly or wrapped. */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const wrapped = result as { rows?: T[] };
  return wrapped.rows ?? [];
}

/** `returning *` gives snake_case columns; map the few the callers read. */
function fromRow(row: Record<string, unknown>): Job {
  const value = row as Record<string, unknown> & Partial<Job>;
  return {
    ...(value as unknown as Job),
    tenantId: (value.tenantId ?? value['tenant_id']) as string | null,
    maxAttempts: Number(value.maxAttempts ?? value['max_attempts'] ?? 5),
    runAfter: new Date((value.runAfter ?? value['run_after']) as string | Date),
    claimedBy: (value.claimedBy ?? value['claimed_by']) as string | null,
    lastError: (value.lastError ?? value['last_error']) as string | null,
    dedupeKey: (value.dedupeKey ?? value['dedupe_key']) as string | null,
  };
}

export async function start(jobId: string): Promise<void> {
  const db = unsafeAdminDb();
  await db.update(jobs).set({ state: 'running', startedAt: new Date() }).where(eq(jobs.id, jobId));
}

export async function complete(jobId: string): Promise<void> {
  const db = unsafeAdminDb();
  await db.update(jobs).set({ state: 'done', finishedAt: new Date(), lastError: null }).where(eq(jobs.id, jobId));
}

/** Exponential backoff with a ceiling; `dead` once the attempts are spent. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, 15 * 60 * 1000);
}

export async function fail(jobId: string, error: unknown, now = new Date()): Promise<JobState> {
  const db = unsafeAdminDb();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return 'dead';

  const message = error instanceof Error ? error.message : String(error);
  const spent = job.attempts >= job.maxAttempts;
  const state: JobState = spent ? 'dead' : 'queued';

  await db.update(jobs).set({
    state,
    lastError: message.slice(0, 2000),
    finishedAt: spent ? now : null,
    claimedBy: null,
    claimedAt: null,
    runAfter: spent ? job.runAfter : new Date(now.getTime() + backoffMs(job.attempts)),
  }).where(eq(jobs.id, jobId));

  return state;
}

export async function cancel(jobId: string): Promise<void> {
  const db = unsafeAdminDb();
  await db.update(jobs)
    .set({ state: 'cancelled', finishedAt: new Date() })
    .where(and(eq(jobs.id, jobId), inArray(jobs.state, ['queued', 'claimed'])));
}

/** Jobs that died. The dead-letter view the admin console reads. */
export async function deadLetters(limit = 100): Promise<Job[]> {
  const db = unsafeAdminDb();
  return db.select().from(jobs).where(eq(jobs.state, 'dead')).orderBy(asc(jobs.finishedAt)).limit(limit);
}

/** A worker that stopped mid-job leaves a claim behind; reclaim after the lease expires. */
export async function releaseStale(olderThanMs = 5 * 60 * 1000, now = new Date()): Promise<number> {
  const db = unsafeAdminDb();
  const cutoff = new Date(now.getTime() - olderThanMs);
  const released = await db.update(jobs)
    .set({ state: 'queued', claimedBy: null, claimedAt: null })
    .where(and(
      inArray(jobs.state, ['claimed', 'running']),
      or(lte(jobs.claimedAt, cutoff), isNull(jobs.claimedAt)),
    ))
    .returning();
  return released.length;
}
