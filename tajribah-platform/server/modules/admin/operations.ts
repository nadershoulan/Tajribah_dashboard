/**
 * A11 — platform operations, for staff: is the work getting done?
 *
 *  - **Queues**: per queue, what is ready now, what is scheduled for later (a retry's backoff),
 *    what a worker holds, what died, what finished in the last day, and how long the oldest
 *    ready job has waited — the lag a merchant feels.
 *  - **Stuck**: jobs a worker claimed longer ago than the lease; `releaseStale` hands them back
 *    on its own, so a long list here means the sweep is not running.
 *  - **Dead jobs** and **failed webhook deliveries**: the ones waiting for a person. Staff can
 *    retry either, with a reason. A retry is the same status change the system makes (a job
 *    back to `queued`; a delivery through the store's own `replayWebhook`), never a second path.
 *  - **Key rotation** (T16): how many sealed values are not yet under the current
 *    `ENCRYPTION_KEY`, and so whether `ENCRYPTION_KEY_PREVIOUS` can be removed.
 */
import { and, count, desc, eq, gte, inArray, isNotNull, lt, lte, min, notLike, or, sql } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { jobs, storeConnections, tenants, users, webhookEvents } from '@/db/schema';
import { encryptionKeyId } from '@/server/core/auth/crypto';
import { loadEnv } from '@/server/core/config/env';
import { errors } from '@/server/core/errors/problem';
import { replayWebhook } from '@/server/modules/webhooks/service';
import { staffLog, type StaffContext } from './access';
import { staffActingContext } from './stores';

const DAY = 86_400_000;
/** The lease `releaseStale` uses: a claim older than this belongs to a worker that stopped. */
export const LEASE_MS = 5 * 60 * 1000;

export type QueueHealth = {
  queue: string; ready: number; scheduled: number; running: number; dead: number; doneLastDay: number;
  /** Seconds the oldest ready job has waited; null when none is waiting. */
  lagSeconds: number | null;
};
type StoreRef = { id: string; name: string; nameAr: string | null } | null;
export type JobRow = { id: string; queue: string; store: StoreRef; state: string; attempts: number; maxAttempts: number; lastError: string | null; claimedBy: string | null; claimedAt: string | null; finishedAt: string | null; createdAt: string };
export type WebhookRow = { id: string; provider: string; topic: string; store: StoreRef; attempts: number; error: string | null; createdAt: string };
export type KeyRotation = {
  currentKeyId: string; previousKeySet: boolean;
  /** Sealed values not under the current key, by where they live. */
  pending: { connectionTokens: number; authenticatorSecrets: number };
  /** True when a previous key is set and nothing still needs it. */
  previousKeyRemovable: boolean;
};
export type Operations = {
  queues: QueueHealth[]; stuck: JobRow[]; dead: JobRow[];
  webhooks: { lastDay: Record<'received' | 'processed' | 'failed' | 'ignored', number>; failed: WebhookRow[]; overdue: number };
  keys: KeyRotation;
  asOf: string;
};

export async function operations(now = new Date()): Promise<Operations> {
  const db = unsafeAdminDb(); // platform infrastructure, across every store (A1)
  const dayAgo = new Date(now.getTime() - DAY);

  const byState = await db.select({
    queue: jobs.queue, state: jobs.state, future: sql<boolean>`${jobs.runAfter} > ${now.toISOString()}`.as('future'), n: count(),
  }).from(jobs)
    .where(or(inArray(jobs.state, ['queued', 'claimed', 'running', 'dead']), and(eq(jobs.state, 'done'), gte(jobs.finishedAt, dayAgo))))
    .groupBy(jobs.queue, jobs.state, sql`future`);
  const oldest = await db.select({ queue: jobs.queue, at: min(jobs.runAfter) }).from(jobs)
    .where(and(eq(jobs.state, 'queued'), lte(jobs.runAfter, now))).groupBy(jobs.queue);
  const queues = new Map<string, QueueHealth>();
  const q = (name: string) => queues.get(name) ?? queues.set(name, { queue: name, ready: 0, scheduled: 0, running: 0, dead: 0, doneLastDay: 0, lagSeconds: null }).get(name)!;
  for (const row of byState) {
    const health = q(row.queue);
    const n = Number(row.n);
    if (row.state === 'queued') { if (row.future) health.scheduled += n; else health.ready += n; }
    else if (row.state === 'claimed' || row.state === 'running') health.running += n;
    else if (row.state === 'dead') health.dead += n;
    else if (row.state === 'done') health.doneLastDay += n;
  }
  for (const row of oldest) if (row.at) q(row.queue).lagSeconds = Math.max(0, Math.round((now.getTime() - new Date(row.at).getTime()) / 1000));

  const stuck = await jobRows(db, and(inArray(jobs.state, ['claimed', 'running']), lt(jobs.claimedAt, new Date(now.getTime() - LEASE_MS))), 50);
  const dead = await jobRows(db, eq(jobs.state, 'dead'), 50);

  const hooks = await db.select({ status: webhookEvents.status, n: count() }).from(webhookEvents)
    .where(gte(webhookEvents.createdAt, dayAgo)).groupBy(webhookEvents.status);
  const lastDay = { received: 0, processed: 0, failed: 0, ignored: 0 };
  for (const h of hooks) lastDay[h.status] = Number(h.n);
  const failedRows = await db.select({ event: webhookEvents, tenant: tenants }).from(webhookEvents)
    .innerJoin(tenants, eq(tenants.id, webhookEvents.tenantId))
    .where(eq(webhookEvents.status, 'failed')).orderBy(desc(webhookEvents.createdAt)).limit(50);
  // Waiting more than 15 minutes past when it was due: the dispatcher is behind or not running.
  const [overdue] = await db.select({ n: count() }).from(webhookEvents).where(and(
    eq(webhookEvents.status, 'received'),
    or(and(isNotNull(webhookEvents.nextAttemptAt), lt(webhookEvents.nextAttemptAt, new Date(now.getTime() - 15 * 60_000))),
      and(sql`${webhookEvents.nextAttemptAt} is null`, lt(webhookEvents.createdAt, new Date(now.getTime() - 15 * 60_000)))),
  ));

  return {
    queues: [...queues.values()].sort((a, b) => a.queue.localeCompare(b.queue)),
    stuck, dead,
    webhooks: {
      lastDay,
      failed: failedRows.map(({ event, tenant }) => ({
        id: event.id, provider: event.provider, topic: event.topic, store: { id: tenant.id, name: tenant.name, nameAr: tenant.nameAr },
        attempts: event.attempts, error: event.error, createdAt: event.createdAt.toISOString(),
      })),
      overdue: Number(overdue?.n ?? 0),
    },
    keys: await keyRotation(db),
    asOf: now.toISOString(),
  };
}

async function jobRows(db: Db, where: ReturnType<typeof and>, limit: number): Promise<JobRow[]> {
  const rows = await db.select({ job: jobs, tenant: tenants }).from(jobs).leftJoin(tenants, eq(tenants.id, jobs.tenantId))
    .where(where).orderBy(desc(jobs.updatedAt)).limit(limit);
  return rows.map(({ job, tenant }) => ({
    id: job.id, queue: job.queue, store: tenant ? { id: tenant.id, name: tenant.name, nameAr: tenant.nameAr } : null, state: job.state,
    attempts: job.attempts, maxAttempts: job.maxAttempts, lastError: job.lastError, claimedBy: job.claimedBy,
    claimedAt: job.claimedAt?.toISOString() ?? null, finishedAt: job.finishedAt?.toISOString() ?? null, createdAt: job.createdAt.toISOString(),
  }));
}

/** T16: what still needs the previous key. The key id is a one-way tag of the key, never the key. */
export async function keyRotation(db: Db = unsafeAdminDb()): Promise<KeyRotation> {
  const env = loadEnv();
  const currentKeyId = await encryptionKeyId(env.ENCRYPTION_KEY);
  const current = `v2.${currentKeyId}.%`;
  const [tokens] = await db.select({ n: count() }).from(storeConnections).where(or(
    and(isNotNull(storeConnections.accessTokenEncrypted), notLike(storeConnections.accessTokenEncrypted, current)),
    and(isNotNull(storeConnections.refreshTokenEncrypted), notLike(storeConnections.refreshTokenEncrypted, current)),
  ));
  const [secrets] = await db.select({ n: count() }).from(users)
    .where(and(isNotNull(users.totpSecretEncrypted), notLike(users.totpSecretEncrypted, current)));
  const pending = { connectionTokens: Number(tokens?.n ?? 0), authenticatorSecrets: Number(secrets?.n ?? 0) };
  const previousKeySet = !!env.ENCRYPTION_KEY_PREVIOUS;
  return { currentKeyId, previousKeySet, pending, previousKeyRemovable: previousKeySet && pending.connectionTokens === 0 && pending.authenticatorSecrets === 0 };
}

const needReason = (reason: string) => {
  const trimmed = reason.trim();
  if (trimmed.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  return trimmed;
};

/** Put a dead job back in its queue, from the start of its attempts. */
export async function retryJob(staff: StaffContext, id: string, reason: string, now = new Date()): Promise<void> {
  const why = needReason(reason);
  await unsafeAdminDb().transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
    if (!job) throw errors.notFound('job');
    if (job.state !== 'dead') throw errors.conflict('only a dead job can be retried');
    await tx.update(jobs).set({ state: 'queued', attempts: 0, runAfter: now, finishedAt: null, claimedBy: null, claimedAt: null, updatedAt: now }).where(eq(jobs.id, id));
    await staffLog(staff, { action: 'job.retry', targetType: 'job', targetId: id, storeId: job.tenantId, reason: why, detail: { queue: job.queue, lastError: job.lastError?.slice(0, 500) ?? null } }, tx as unknown as Db);
  });
}

/** Replay a failed delivery through the store's own replay (its trail records staff), then the staff trail. */
export async function replayDelivery(staff: StaffContext, id: string, reason: string): Promise<void> {
  const why = needReason(reason);
  const db = unsafeAdminDb();
  const [found] = await db.select({ event: webhookEvents, tenant: tenants }).from(webhookEvents)
    .innerJoin(tenants, eq(tenants.id, webhookEvents.tenantId)).where(eq(webhookEvents.id, id)).limit(1);
  if (!found) throw errors.notFound('webhook delivery');
  if (found.event.status !== 'failed') throw errors.conflict('only a failed delivery is replayed from here');
  await replayWebhook(staffActingContext(found.tenant, staff, ['connections:read', 'connections:write']), id);
  await staffLog(staff, { action: 'webhook.replay', targetType: 'webhook_event', targetId: id, storeId: found.tenant.id, reason: why, detail: { topic: found.event.topic, provider: found.event.provider } });
}
