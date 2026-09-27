/**
 * A9 — AI operations, for staff: is the AI work getting done, and what does it cost us?
 *
 *  - **By type**: jobs in the window by outcome, how long a finished one took (median), what the
 *    providers charged us (`actual_cost_cents`, US cents, §7.8) and GPU time.
 *  - **Credits against cost**: what merchants were charged (the ledger: consumption less refunds,
 *    per job, so a refunded job nets to zero) beside what the work cost us. **No margin figure**:
 *    a credit has no price yet (the plans grant them; buying them waits on P2.5), and a margin
 *    built on a guessed price would be the number most likely to be believed and wrong.
 *  - **Failures**: the latest failed jobs with the provider's own error text — staff see it, the
 *    merchant never does (P3.2).
 *  - **Running long**: processing with no word for `QUIET_MS`; the sweep fails them at an hour.
 *    Staff can cancel one, with a reason, through the store's own cancel (T24 applies: a job the
 *    provider was working on keeps its charge).
 *  - **Top stores by cost**: where the money goes.
 */
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { aiJobEvents, aiJobs, creditLedger, tenants } from '@/db/schema';
import { errors } from '@/server/core/errors/problem';
import { cancelAiJob } from '@/server/modules/ai-jobs/lifecycle';
import { staffLog, type StaffContext } from './access';
import { staffActingContext } from './stores';

const DAY = 86_400_000;
/** No progress, cost or result for this long: worth a look (the sweep acts at an hour). */
export const QUIET_MS = 20 * 60 * 1000;

type StoreRef = { id: string; name: string; nameAr: string | null };
export type AiTypeStats = {
  type: string; total: number; done: number; failed: number; cancelled: number; open: number;
  medianSeconds: number | null; costCents: number; gpuSeconds: number; creditsCharged: number;
};
export type AiJobRow = {
  id: string; type: string; status: string; store: StoreRef; creditsCost: number; costCents: number; attempts: number;
  errorCode: string | null; errorMessage: string | null; queuedAt: string | null; startedAt: string | null; finishedAt: string | null;
  lastHeardAt: string | null;
};
export type AiOperations = {
  days: number;
  totals: { jobs: number; costCents: number; gpuSeconds: number; creditsCharged: number; failureRate: number | null };
  byType: AiTypeStats[];
  failures: AiJobRow[];
  quiet: AiJobRow[];
  topStores: (StoreRef & { jobs: number; costCents: number; creditsCharged: number })[];
  asOf: string;
};

export async function aiOperations(days: 7 | 30 | 90 = 30, now = new Date()): Promise<AiOperations> {
  const db = unsafeAdminDb(); // staff read across every store (A1)
  const since = new Date(now.getTime() - days * DAY);
  const jobs = await db.select({ job: aiJobs, tenant: tenants }).from(aiJobs)
    .innerJoin(tenants, eq(tenants.id, aiJobs.tenantId))
    .where(gte(aiJobs.createdAt, since)).orderBy(desc(aiJobs.createdAt)).limit(20_000);

  // Credits per job: consumption (negative) plus its refund (positive), so a refunded job nets 0.
  const ids = jobs.map(({ job }) => job.id);
  const charged = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 1000) {
    const rows = await db.select({ id: creditLedger.referenceId, delta: creditLedger.delta }).from(creditLedger)
      .where(and(inArray(creditLedger.referenceType, ['ai_job', 'ai_job_refund']), inArray(creditLedger.referenceId, ids.slice(i, i + 1000))));
    for (const row of rows) charged.set(row.id!, (charged.get(row.id!) ?? 0) - row.delta);
  }

  const byType = new Map<string, AiTypeStats & { durations: number[] }>();
  const stores = new Map<string, StoreRef & { jobs: number; costCents: number; creditsCharged: number }>();
  let costCents = 0, gpuSeconds = 0, creditsCharged = 0, ended = 0, failed = 0;
  for (const { job, tenant } of jobs) {
    const t = byType.get(job.type) ?? { type: job.type, total: 0, done: 0, failed: 0, cancelled: 0, open: 0, medianSeconds: null, costCents: 0, gpuSeconds: 0, creditsCharged: 0, durations: [] };
    t.total++;
    if (job.status === 'done') t.done++;
    else if (job.status === 'failed') t.failed++;
    else if (job.status === 'cancelled') t.cancelled++;
    else t.open++;
    const credits = charged.get(job.id) ?? 0;
    t.costCents += job.actualCostCents; t.gpuSeconds += job.gpuSeconds ?? 0; t.creditsCharged += credits;
    if (job.status === 'done' && job.startedAt && job.finishedAt) t.durations.push((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000);
    byType.set(job.type, t);

    const s = stores.get(tenant.id) ?? { id: tenant.id, name: tenant.name, nameAr: tenant.nameAr, jobs: 0, costCents: 0, creditsCharged: 0 };
    s.jobs++; s.costCents += job.actualCostCents; s.creditsCharged += credits;
    stores.set(tenant.id, s);

    costCents += job.actualCostCents; gpuSeconds += job.gpuSeconds ?? 0; creditsCharged += credits;
    // A job the merchant cancelled says nothing about whether the work succeeds.
    if (job.status === 'done' || job.status === 'failed') { ended++; if (job.status === 'failed') failed++; }
  }

  const failures = jobs.filter(({ job }) => job.status === 'failed').slice(0, 25);
  const processing = jobs.filter(({ job }) => job.status === 'processing');
  const heard = await lastHeard(processing.map(({ job }) => job.id));
  const quiet = processing.filter(({ job }) => {
    const last = heard.get(job.id) ?? job.startedAt ?? job.createdAt;
    return now.getTime() - last.getTime() > QUIET_MS;
  });

  return {
    days,
    totals: { jobs: jobs.length, costCents, gpuSeconds, creditsCharged, failureRate: ended ? failed / ended : null },
    byType: [...byType.values()].map(({ durations, ...rest }) => ({ ...rest, medianSeconds: median(durations) })).sort((a, b) => b.total - a.total),
    failures: failures.map(({ job, tenant }) => rowOf(job, tenant, charged, heard)),
    quiet: quiet.map(({ job, tenant }) => rowOf(job, tenant, charged, heard)),
    topStores: [...stores.values()].sort((a, b) => b.costCents - a.costCents || b.jobs - a.jobs).slice(0, 10),
    asOf: now.toISOString(),
  };
}

async function lastHeard(ids: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!ids.length) return out;
  const rows = await unsafeAdminDb().select({ id: aiJobEvents.jobId, at: sql<string>`max(${aiJobEvents.createdAt})` }).from(aiJobEvents)
    .where(inArray(aiJobEvents.jobId, ids)).groupBy(aiJobEvents.jobId);
  for (const row of rows) out.set(row.id, new Date(row.at));
  return out;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
}

function rowOf(job: typeof aiJobs.$inferSelect, tenant: typeof tenants.$inferSelect, charged: Map<string, number>, heard: Map<string, Date>): AiJobRow {
  return {
    id: job.id, type: job.type, status: job.status, store: { id: tenant.id, name: tenant.name, nameAr: tenant.nameAr },
    creditsCost: charged.get(job.id) ?? 0, costCents: job.actualCostCents, attempts: job.attempts,
    errorCode: job.errorCode, errorMessage: job.errorMessage,
    queuedAt: job.queuedAt?.toISOString() ?? null, startedAt: job.startedAt?.toISOString() ?? null, finishedAt: job.finishedAt?.toISOString() ?? null,
    lastHeardAt: heard.get(job.id)?.toISOString() ?? null,
  };
}

/** Cancel a job for a store, with a reason — the store's own cancel, recorded in both trails. */
export async function cancelJobForStore(staff: StaffContext, jobId: string, reason: string): Promise<void> {
  const why = reason.trim();
  if (why.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  const [found] = await unsafeAdminDb().select({ job: aiJobs, tenant: tenants }).from(aiJobs)
    .innerJoin(tenants, eq(tenants.id, aiJobs.tenantId)).where(eq(aiJobs.id, jobId)).limit(1);
  if (!found) throw errors.notFound('ai_job');
  await cancelAiJob(staffActingContext(found.tenant, staff, ['models:read', 'models:write', 'products:write']), jobId);
  await staffLog(staff, { action: 'ai_job.cancel', targetType: 'ai_job', targetId: jobId, storeId: found.tenant.id, reason: why, detail: { type: found.job.type, was: found.job.status } });
}
