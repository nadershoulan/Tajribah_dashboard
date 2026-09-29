/**
 * P6 — the model registry & A/B: which provider model does a new AI job, and how each model does.
 *
 *  - **Choosing.** A job type's active models share its jobs by their `ab_split_percent` (they add
 *    up to 100 — the admin console keeps them so). The job's id decides its place in the split
 *    (a stable hash into 0–99), so a retried or redelivered job always goes to the same model, and
 *    the choice is written on the job (`ai_jobs.model_registry_id`) for its executor to use.
 *    No active model for a type → no choice: the executor uses its own default.
 *  - **How each model does**, from the jobs themselves — not from numbers a provider reports:
 *    jobs, finished, failed, success rate, median time and what it cost us. That is what an A/B
 *    comparison and a rollback decision rest on.
 *
 * Platform reads (the registry has no tenant; the outcomes span every store): the admin handle.
 */
import { and, asc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { aiJobs, modelRegistry, AI_JOB_TYPE } from '@/db/schema';

type AiJobType = (typeof AI_JOB_TYPE)[number];
export type RegistryModel = typeof modelRegistry.$inferSelect;

/** A stable place in 0–99 for a job id (FNV-1a) — the same id always lands in the same place. */
export function bucketOf(jobId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < jobId.length; i++) {
    hash ^= jobId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

/** Pick from `models` (active, one type) by their splits for place `bucket`. Null when none takes a share. */
export function pick(models: Pick<RegistryModel, 'id' | 'abSplitPercent'>[], bucket: number): string | null {
  const total = models.reduce((n, m) => n + Math.max(0, m.abSplitPercent), 0);
  if (total <= 0) return null;
  // Splits add up to 100 when the console set them; scaled if they somehow do not, never dropped.
  const place = (bucket / 100) * total;
  let upTo = 0;
  for (const m of models) {
    upTo += Math.max(0, m.abSplitPercent);
    if (place < upTo) return m.id;
  }
  return models.at(-1)!.id;
}

/** The model a new job of `type` goes to, or null. */
export async function chooseModel(type: AiJobType, jobId: string): Promise<string | null> {
  const models = await unsafeAdminDb().select({ id: modelRegistry.id, abSplitPercent: modelRegistry.abSplitPercent })
    .from(modelRegistry)
    .where(and(eq(modelRegistry.jobType, type), eq(modelRegistry.isActive, true)))
    .orderBy(asc(modelRegistry.name), asc(modelRegistry.version), asc(modelRegistry.id));
  return pick(models, bucketOf(jobId));
}

export type ModelOutcomes = { jobs: number; done: number; failed: number; successRate: number | null; medianSeconds: number | null; costCents: number };

/** What each model's jobs did since `since`, by model id. */
export async function modelOutcomes(since: Date): Promise<Map<string, ModelOutcomes>> {
  const rows = await unsafeAdminDb().select({
    id: aiJobs.modelRegistryId,
    jobs: sql<string>`count(*)`,
    done: sql<string>`count(*) filter (where ${aiJobs.status} = 'done')`,
    failed: sql<string>`count(*) filter (where ${aiJobs.status} = 'failed')`,
    median: sql<string | null>`percentile_cont(0.5) within group (order by extract(epoch from (${aiJobs.finishedAt} - ${aiJobs.startedAt}))) filter (where ${aiJobs.status} = 'done' and ${aiJobs.startedAt} is not null)`,
    cost: sql<string>`coalesce(sum(${aiJobs.actualCostCents}), 0)`,
  }).from(aiJobs).where(and(isNotNull(aiJobs.modelRegistryId), gte(aiJobs.createdAt, since))).groupBy(aiJobs.modelRegistryId);
  const out = new Map<string, ModelOutcomes>();
  for (const r of rows) {
    const done = Number(r.done);
    const failed = Number(r.failed);
    out.set(r.id!, {
      jobs: Number(r.jobs), done, failed,
      successRate: done + failed > 0 ? done / (done + failed) : null,
      medianSeconds: r.median === null ? null : Math.round(Number(r.median)),
      costCents: Number(r.cost),
    });
  }
  return out;
}
