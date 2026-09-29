/**
 * P3.2 ⭐ — the AI job lifecycle: what a merchant is charged, what they see, and what happens
 * when a job fails, is cancelled, or is delivered twice.
 *
 *   queued ──begin──▶ processing ──finish──▶ done
 *     │                  │  └──────fail────▶ failed      (credits given back)
 *     └──────cancel──────┴──────cancel─────▶ cancelled   (credits given back)
 *
 * Rules that are not style choices:
 *  - **The `ai_jobs` row is the truth the merchant sees; the queue only delivers work** (T6).
 *    Delivery is at-least-once, so every transition is a conditional UPDATE on the status it
 *    expects: a job finishes once, a late result after a cancel is discarded, a redelivered job
 *    that already finished does nothing.
 *  - **Charged once, refunded once.** Credits are consumed against the job's id (the ledger's
 *    unique reference, P2.9) when it is dispatched, and given back against the same id when it
 *    fails, or is cancelled before it starts. A job refused for credits never runs.
 *  - **Cancelling is immediate for the merchant** (T24, Nader's): the status flips at once. Before
 *    the job starts, the credits come back; once the provider is working, they are kept — the
 *    work was paid for. A worker mid-way learns of the cancel at its next progress report and
 *    stops; if it finishes anyway, its result is thrown away — but what it cost us is still
 *    recorded, because `actual_cost_cents` is how we learn whether a plan pays (§7.8).
 *  - **The merchant never sees a provider's error text.** `error_message` keeps it for staff;
 *    the merchant gets the code's own wording (`lib/ai-jobs.ts`).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { aiJobEvents, aiJobs, AI_JOB_TYPE, products } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { AI_JOB_ERRORS, AI_JOB_STAGES, type AiJobErrorCode, type AiJobStage } from '@/lib/ai-jobs';
import type { AiJobView } from '@/lib/view-models';
import type { Permission } from '@/lib/permissions';
import { record } from '@/server/core/audit/audit';
import { errors, isAppError } from '@/server/core/errors/problem';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { enqueue, type QueueName } from '@/server/core/jobs/queue';
import { log } from '@/server/core/observability/log';
import { systemContext, type TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { consumeCredits, refundCredits } from '@/server/modules/billing/credits';
import { CREDITS_PER_3D_GENERATION } from '@/lib/ai-credits';
import { assertWithinGuardrails } from './guardrails';
import { emitEvent } from '@/server/modules/outgoing-webhooks/emit';
import { aiJobV1 } from '@/server/modules/public-api/v1';

export type AiJobType = (typeof AI_JOB_TYPE)[number];
export type AiJob = typeof aiJobs.$inferSelect;

/** Where each type runs and who may start it. Models work is `models:write`; catalogue text is `products:write`. */
/** `feature` (T35): the plan feature a job needs — 3D work is `ai_3d` (Pro and up), product embeddings serve recommendations (Pro and up); content enrichment is in no plan's list, so it is not gated. */
export const AI_JOB_ROUTES: Record<AiJobType, { queue: QueueName; permission: Permission; feature: string | null }> = {
  generate_3d: { queue: 'ai.generate-3d', permission: 'models:write', feature: 'ai_3d' },
  enhance_texture: { queue: 'ai.generate-3d', permission: 'models:write', feature: 'ai_3d' },
  quality_check: { queue: 'ai.generate-3d', permission: 'models:write', feature: 'ai_3d' },
  convert_format: { queue: 'ai.generate-3d', permission: 'models:write', feature: 'ai_3d' },
  embed_product: { queue: 'ai.embed', permission: 'products:write', feature: 'recommendations' },
  enrich_content: { queue: 'ai.embed', permission: 'products:write', feature: null },
};

/** Queue attempts for one AI job. Each attempt can cost real money, so fewer than the default five. */
export const AI_JOB_MAX_ATTEMPTS = 3;

/** What background work may do to a store: run its jobs and give back its credits. */
const WORKER_PERMISSIONS: Permission[] = ['models:write', 'products:write'];

// ------------------------------------------------------------------------------ executors

export type ProgressReport = { percent: number; stage?: AiJobStage };
export type ExecutorResult = { output: Record<string, unknown>; cost?: JobCost };
export type JobCost = { actualCostCents?: number; gpuSeconds?: number };

/**
 * The work itself — a provider adapter (P3.4 onwards). It receives the job and a `report`
 * function; `report` answers `{ cancelled: true }` once the merchant has cancelled, and the
 * executor should stop there. An executor must be safe to run twice for the same job id.
 */
export type AiExecutor = (job: AiJob, report: (progress: ProgressReport) => Promise<{ cancelled: boolean }>) => Promise<ExecutorResult>;

/** A failure the executor understands. `retryable: false` ends the job at once. */
export class AiJobError extends Error {
  constructor(readonly code: AiJobErrorCode, message: string, readonly options: { retryable: boolean; cost?: JobCost } = { retryable: false }) {
    super(message);
    this.name = 'AiJobError';
  }
}

const executors = new Map<AiJobType, AiExecutor>();

export function registerExecutor(type: AiJobType, executor: AiExecutor): void {
  if (executors.has(type)) throw new Error(`an executor for "${type}" is already registered`);
  executors.set(type, executor);
}

/** Tests only. */
export function clearExecutors(): void {
  executors.clear();
}

// ------------------------------------------------------------------------------ events

async function event(db: TenantDb, jobId: string, name: string, detail: Record<string, unknown> | null = null, at = new Date()): Promise<void> {
  await db.insert(aiJobEvents, { id: uuidv7(at.getTime()), jobId, event: name, detail, createdAt: at } as never);
}

/** Change the job only if it is still in one of `from`; the changed row, or null if it had moved on. */
async function transition(db: TenantDb, jobId: string, from: AiJob['status'][], values: Partial<AiJob>): Promise<AiJob | null> {
  const [row] = await db.update(aiJobs, and(eq(aiJobs.id, jobId), inArray(aiJobs.status, from))!, values as never);
  return row ?? null;
}

/** Add what an attempt cost us to what the job has cost so far. Recorded whatever the outcome. */
async function addCost(db: TenantDb, job: AiJob, cost: JobCost | undefined): Promise<void> {
  if (!cost || (!cost.actualCostCents && !cost.gpuSeconds)) return;
  const cents = Math.max(0, Math.round(cost.actualCostCents ?? 0));
  const gpu = Math.max(0, Math.round(cost.gpuSeconds ?? 0));
  const fresh = await db.lockById(aiJobs, job.id);
  await db.updateById(aiJobs, job.id, { actualCostCents: fresh.actualCostCents + cents, gpuSeconds: (fresh.gpuSeconds ?? 0) + gpu } as never);
  await event(db, job.id, 'cost', { actualCostCents: cents, gpuSeconds: gpu });
}

// ------------------------------------------------------------------------------ merchant side

export type CreateAiJob = {
  type: AiJobType;
  input: Record<string, unknown>;
  /** What the merchant is charged. The adapter that knows the work sets it; this module never guesses a price. */
  creditsCost: number;
  priority?: number;
  parentJobId?: string | null;
};

/**
 * Ask for a job: the row, then the charge, then the queue. A charge refused for credits leaves
 * the job `failed` with `insufficient_credits` (the merchant saw why) and throws 409.
 */
export async function createAiJob(ctx: TenantContext, request: CreateAiJob): Promise<AiJobView> {
  const route = AI_JOB_ROUTES[request.type];
  if (!route) throw errors.validation({ type: ['not a job type'] });
  ctx.require(route.permission);
  if (route.feature) assertFeature(await entitlementsOf(ctx), route.feature); // T35: before any charge
  if (!Number.isInteger(request.creditsCost) || request.creditsCost < 1) throw errors.validation({ creditsCost: ['a whole number of credits, at least 1'] });
  // T55: a 3D generation has one price, the one every screen states.
  if (request.type === 'generate_3d' && request.creditsCost !== CREDITS_PER_3D_GENERATION) throw errors.validation({ creditsCost: [`a 3D generation costs ${CREDITS_PER_3D_GENERATION} credits`] });

  const now = new Date();
  await assertWithinGuardrails(ctx.tenantId, request.type, now); // P6.7: before the row and the charge
  const job = await withTenant(ctx.tenantId, async (db) => {
    const row = await db.insert(aiJobs, {
      id: uuidv7(now.getTime()), type: request.type, status: 'queued', priority: request.priority ?? 100,
      input: request.input, creditsCost: request.creditsCost, queuedAt: now, parentJobId: request.parentJobId ?? null,
    } as never);
    await event(db, row.id, 'queued', { creditsCost: request.creditsCost }, now);
    await record(ctx, { action: 'create', resourceType: 'ai_job', resourceId: row.id, after: { type: row.type, creditsCost: row.creditsCost } as never }, db);
    return row;
  });
  return view(await dispatch(ctx, job));
}

/**
 * Charge and enqueue a queued job. Safe to repeat: the charge is keyed by the job id and the
 * queue job by a dedupe key, so the sweep can re-run it for a job whose process died in between.
 */
export async function dispatch(ctx: TenantContext, job: AiJob): Promise<AiJob> {
  try {
    await consumeCredits(ctx, job.creditsCost, job.id);
  } catch (error) {
    if (isAppError(error) && error.code === 'conflict') {
      const failed = await withTenant(ctx.tenantId, async (db) => {
        const row = await transition(db, job.id, ['queued'], { status: 'failed', finishedAt: new Date(), errorCode: 'insufficient_credits', errorMessage: error.message });
        if (row) await event(db, job.id, 'failed', { code: 'insufficient_credits' });
        return row;
      });
      throw errors.conflict(failed ? error.message : 'the job is no longer waiting');
    }
    throw error;
  }
  await withTenant(ctx.tenantId, (db) => event(db, job.id, 'charged', { credits: job.creditsCost }));
  await enqueue({
    queue: AI_JOB_ROUTES[job.type].queue, tenantId: ctx.tenantId, payload: { aiJobId: job.id },
    priority: job.priority, maxAttempts: AI_JOB_MAX_ATTEMPTS, dedupeKey: `ai-job:${job.id}`,
  });
  return withTenant(ctx.tenantId, async (db) => {
    await event(db, job.id, 'dispatched');
    return db.requireById(aiJobs, job.id);
  });
}

/**
 * Cancel a job that has not ended. Immediate; credits back only if it had not started (T24).
 * Tried as two conditional updates — `queued` first — so the refund follows the state the job
 * was really in, even if a worker picks it up at the same moment. Cancelling a job that already
 * ended is a 409 naming how it ended — never a silent success.
 */
export async function cancelAiJob(ctx: TenantContext, jobId: string): Promise<AiJobView> {
  const found = await withTenant(ctx.tenantId, (db) => db.findById(aiJobs, jobId));
  if (!found) throw errors.notFound('ai_job');
  ctx.require(AI_JOB_ROUTES[found.type].permission);

  const was = await withTenant(ctx.tenantId, async (db) => {
    const values = { status: 'cancelled' as const, finishedAt: new Date() };
    const from = (await transition(db, jobId, ['queued'], values)) ? 'queued'
      : (await transition(db, jobId, ['processing'], values)) ? 'processing' : null;
    if (!from) return null;
    await event(db, jobId, 'cancelled', { was: from, by: ctx.actor.userId ?? null });
    await record(ctx, { action: 'update', resourceType: 'ai_job', resourceId: jobId, before: { status: from } as never, after: { status: 'cancelled' } as never }, db);
    return from;
  });
  if (!was) {
    const now = await withTenant(ctx.tenantId, (db) => db.requireById(aiJobs, jobId));
    throw errors.conflict(`the job has already ended: ${now.status}`);
  }
  if (was === 'queued') await giveBack(ctx, jobId);
  await announceEnded(ctx, jobId);
  return aiJobView(ctx, jobId);
}

/** P8: the store's webhook endpoints hear that a job ended — done, failed or cancelled (after any refund). */
async function announceEnded(ctx: TenantContext, jobId: string): Promise<void> {
  await emitEvent(ctx, 'ai_job.finished', () => withTenant(ctx.tenantId, async (db) => {
    const job = await db.requireById(aiJobs, jobId);
    const named = await productsOf(db, [job]);
    return aiJobV1(view(job, await extrasOf(db, job), named.get(productIdOf(job)) ?? null));
  }));
}

/** Refund what the job took, once (the ledger's reference makes a second refund impossible). */
async function giveBack(ctx: TenantContext, jobId: string): Promise<void> {
  const entry = await refundCredits(ctx, jobId);
  if (entry) await withTenant(ctx.tenantId, (db) => event(db, jobId, 'refunded', { credits: entry.delta }));
}

// ------------------------------------------------------------------------------ worker side

/**
 * Run one delivery of a job (the queue handler). Returns normally when there is nothing to
 * retry; throws when the queue should try again.
 */
export async function runAiJob(input: { tenantId: string; aiJobId: string; attempt: number; maxAttempts: number; requestId: string }): Promise<void> {
  const { tenantId, aiJobId } = input;
  const started = await withTenant(tenantId, async (db) => {
    const current = await db.findById(aiJobs, aiJobId);
    if (!current) return null;
    if (current.status === 'processing') return current; // redelivered: the executor is idempotent
    const row = await transition(db, aiJobId, ['queued'], { status: 'processing', startedAt: current.startedAt ?? new Date(), attempts: current.attempts + 1 });
    if (row) await event(db, aiJobId, 'started', { attempt: input.attempt });
    return row;
  });
  if (!started) return; // cancelled, finished, or gone: nothing to do

  const executor = executors.get(started.type);
  if (!executor) {
    await endFailed(input, started, new AiJobError('not_available', `no executor for ${started.type}`));
    return;
  }

  const report = (progress: ProgressReport) => reportProgress(tenantId, aiJobId, progress);
  let result: ExecutorResult;
  try {
    result = await executor(started, report);
  } catch (error) {
    const known = error instanceof AiJobError ? error : null;
    const retry = (known ? known.options.retryable : true) && input.attempt < input.maxAttempts;
    await withTenant(tenantId, (db) => addCost(db, started, known?.options.cost));
    if (retry) {
      const back = await withTenant(tenantId, async (db) => {
        const row = await transition(db, aiJobId, ['processing'], { status: 'queued' });
        if (row) await event(db, aiJobId, 'retrying', { attempt: input.attempt, code: known?.code ?? 'provider_failed' });
        return row;
      });
      if (back) throw error; // the queue backs off and delivers again
      return; // cancelled while it ran
    }
    await endFailed(input, started, known ?? new AiJobError('provider_failed', error instanceof Error ? error.message : String(error)));
    return;
  }

  const done = await withTenant(tenantId, async (db) => {
    await addCost(db, started, result.cost);
    const row = await transition(db, aiJobId, ['processing'], { status: 'done', output: result.output, finishedAt: new Date() });
    await event(db, aiJobId, row ? 'done' : 'result_discarded', row ? null : { reason: 'the job was no longer running' });
    return row;
  });
  if (done) await announceEnded(await systemContext({ tenantId, requestId: input.requestId, permissions: WORKER_PERMISSIONS }), aiJobId);
}

/** Progress from the executor: never backwards, never 100 before done. Answers whether to stop. */
export async function reportProgress(tenantId: string, jobId: string, progress: ProgressReport): Promise<{ cancelled: boolean }> {
  return withTenant(tenantId, async (db) => {
    const job = await db.findById(aiJobs, jobId);
    if (!job || job.status !== 'processing') return { cancelled: true };
    const percent = Math.max(0, Math.min(99, Math.floor(Number.isFinite(progress.percent) ? progress.percent : 0)));
    const stage = progress.stage && (AI_JOB_STAGES as readonly string[]).includes(progress.stage) ? progress.stage : null;
    const last = await latestProgress(db, jobId);
    if (last && percent < last.percent) return { cancelled: false };
    await event(db, jobId, 'progress', { percent, stage: stage ?? last?.stage ?? null });
    return { cancelled: false };
  });
}

async function endFailed(input: { tenantId: string; requestId: string }, job: AiJob, error: AiJobError): Promise<void> {
  const failed = await withTenant(input.tenantId, async (db) => {
    const row = await transition(db, job.id, ['processing', 'queued'], {
      status: 'failed', finishedAt: new Date(), errorCode: error.code, errorMessage: error.message.slice(0, 2000),
    });
    if (row) await event(db, job.id, 'failed', { code: error.code });
    return row;
  });
  if (!failed) return;
  log.warn('ai job failed', { jobId: job.id, type: job.type, code: error.code });
  const ctx = await systemContext({ tenantId: input.tenantId, requestId: input.requestId, permissions: WORKER_PERMISSIONS });
  await giveBack(ctx, job.id);
  await announceEnded(ctx, job.id);
}

/**
 * A job the worker gave up on without saying so (its process died on the last attempt):
 * failed as `timed_out`, credits back. Called by the sweep with the store's own context.
 */
export async function failAbandoned(tenantId: string, jobId: string, requestId: string): Promise<boolean> {
  const job = await withTenant(tenantId, (db) => db.findById(aiJobs, jobId));
  if (!job || job.status !== 'processing') return false;
  await endFailed({ tenantId, requestId }, job, new AiJobError('timed_out', 'no word from the worker'));
  return true;
}

/** A queued job whose charge or enqueue never happened (the process died after the insert). */
export async function redispatch(tenantId: string, jobId: string, requestId: string): Promise<boolean> {
  const job = await withTenant(tenantId, (db) => db.findById(aiJobs, jobId));
  if (!job || job.status !== 'queued') return false;
  const ctx = await systemContext({ tenantId, requestId, permissions: WORKER_PERMISSIONS });
  try {
    await dispatch(ctx, job);
  } catch (error) {
    if (!(isAppError(error) && error.code === 'conflict')) throw error;
  }
  return true;
}

// ------------------------------------------------------------------------------ reading

async function latestProgress(db: TenantDb, jobId: string): Promise<{ percent: number; stage: AiJobStage | null } | null> {
  const [row] = await db.find(aiJobEvents, and(eq(aiJobEvents.jobId, jobId), eq(aiJobEvents.event, 'progress')), { limit: 1, orderBy: desc(aiJobEvents.id) });
  const detail = row?.detail as { percent?: number; stage?: AiJobStage | null } | null | undefined;
  return detail ? { percent: Number(detail.percent ?? 0), stage: detail.stage ?? null } : null;
}

type Extras = { percent: number; stage: AiJobStage | null; refunded: boolean };

function view(job: AiJob, extras: Extras = { percent: 0, stage: null, refunded: false }, product: AiJobView['product'] = null): AiJobView {
  const code = job.errorCode as AiJobErrorCode | null;
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    percent: job.status === 'done' ? 100 : extras.percent,
    stage: job.status === 'processing' ? extras.stage : null,
    creditsCost: job.creditsCost,
    refunded: extras.refunded,
    error: job.status === 'failed' && code ? { code, message: (AI_JOB_ERRORS[code] ?? AI_JOB_ERRORS.provider_failed) } : null,
    queuedAt: job.queuedAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    canCancel: job.status === 'queued' || job.status === 'processing',
    product,
  };
}

/** P6.8: the products the jobs name (`input.productId`), in one read. */
async function productsOf(db: TenantDb, jobs: AiJob[]): Promise<Map<string, NonNullable<AiJobView['product']>>> {
  const ids = [...new Set(jobs.map((j) => (j.input as { productId?: unknown } | null)?.productId).filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))];
  const rows = ids.length ? await db.find(products, inArray(products.id, ids), { limit: ids.length }) : [];
  return new Map(rows.map((p) => [p.id, { id: p.id, name: p.name, nameAr: p.nameAr }]));
}
const productIdOf = (job: AiJob) => ((job.input as { productId?: unknown } | null)?.productId as string | undefined) ?? '';

async function extrasOf(db: TenantDb, job: AiJob): Promise<Extras> {
  const progress = await latestProgress(db, job.id);
  const refunded = await db.exists(aiJobEvents, and(eq(aiJobEvents.jobId, job.id), eq(aiJobEvents.event, 'refunded')));
  return { percent: progress?.percent ?? 0, stage: progress?.stage ?? null, refunded };
}

/** API-141 — one job, for a progress bar. */
export async function aiJobView(ctx: TenantContext, jobId: string): Promise<AiJobView> {
  ctx.require('models:read');
  return withTenant(ctx.tenantId, async (db) => {
    const job = await db.findById(aiJobs, jobId);
    if (!job) throw errors.notFound('ai_job');
    const named = await productsOf(db, [job]);
    return view(job, await extrasOf(db, job), named.get(productIdOf(job)) ?? null);
  });
}

/** API-140 — the store's recent jobs, newest first; `active` for the ones still running. */
export async function listAiJobs(ctx: TenantContext, options: { active?: boolean; limit?: number } = {}): Promise<AiJobView[]> {
  ctx.require('models:read');
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  return withTenant(ctx.tenantId, async (db) => {
    const jobs = await db.find(aiJobs, options.active ? inArray(aiJobs.status, ['queued', 'processing']) : undefined, { limit, orderBy: desc(aiJobs.id) });
    const named = await productsOf(db, jobs);
    const out: AiJobView[] = [];
    for (const job of jobs) out.push(view(job, await extrasOf(db, job), named.get(productIdOf(job)) ?? null));
    return out;
  });
}
