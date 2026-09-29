/**
 * P6.7 — AI cost guardrails: the brakes staff can pull when AI work costs more than it should
 * ("AI features are exactly where SaaS margins quietly die", §7.8).
 *
 *  - **Pause a kind of work** — say 3D generation while a provider misbehaves or overcharges. New
 *    jobs of that kind are refused; jobs already running finish, and staff can cancel them from
 *    the AI operations screen.
 *  - **A platform daily spend cap** (US cents: what providers charged us, `actual_cost_cents`).
 *    Once the cost recorded for today's jobs reaches it, every new AI job is refused until
 *    midnight, Riyadh time. Cost is recorded as attempts end, so work already sent can carry the
 *    day past the cap: the cap stops new work, it cannot recall work in flight.
 *  - **A per-store daily job cap** — one store (a script in a loop, a stolen session) cannot start
 *    more than this many AI jobs in a Riyadh day. Jobs refused for credits do not count: they cost
 *    nothing. A soft cap: two jobs asked for in the same instant can both pass.
 *
 * **No number is chosen here.** Every limit starts unset — no limit — and staff set them in the
 * admin console, where each change is logged with its reason. Every refusal comes before the job
 * row and before any credit is charged, and says so.
 */
import { and, eq, gte, isNull, ne, or, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { aiGuardrails, aiJobs, AI_JOB_TYPE } from '@/db/schema';
import { AppError } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';

type AiJobType = (typeof AI_JOB_TYPE)[number];

export type Guardrails = {
  pausedTypes: AiJobType[];
  /** US cents a day, across every store; null = no cap. */
  dailySpendCapCents: number | null;
  /** AI jobs one store may start in a day; null = no cap. */
  storeDailyJobsCap: number | null;
  updatedAt: string | null;
};

export const GUARDRAILS_ID = 'platform';
const HOURS_3 = 3 * 60 * 60 * 1000; // Asia/Riyadh is UTC+3, no daylight saving

/** The first instant of today in Riyadh. */
export function riyadhDayStart(now = new Date()): Date {
  const riyadh = new Date(now.getTime() + HOURS_3);
  return new Date(Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), riyadh.getUTCDate()) - HOURS_3);
}

/** Whole seconds until tomorrow in Riyadh — what a refusal tells the caller to wait. */
export function secondsToTomorrow(now = new Date()): number {
  return Math.max(1, Math.ceil((riyadhDayStart(now).getTime() + 24 * 60 * 60 * 1000 - now.getTime()) / 1000));
}

/** The limits in force. No row means none. */
export async function currentGuardrails(): Promise<Guardrails> {
  const [row] = await unsafeAdminDb().select().from(aiGuardrails).where(eq(aiGuardrails.id, GUARDRAILS_ID)).limit(1);
  if (!row) return { pausedTypes: [], dailySpendCapCents: null, storeDailyJobsCap: null, updatedAt: null };
  return {
    pausedTypes: (row.pausedTypes ?? []).filter((t): t is AiJobType => (AI_JOB_TYPE as readonly string[]).includes(t)),
    dailySpendCapCents: row.dailySpendCapCents, storeDailyJobsCap: row.storeDailyJobsCap,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** What providers have charged us for today's jobs, every store together. */
export async function spentTodayCents(now = new Date()): Promise<number> {
  const [row] = await unsafeAdminDb().select({ cents: sql<string>`coalesce(sum(${aiJobs.actualCostCents}), 0)` })
    .from(aiJobs).where(gte(aiJobs.createdAt, riyadhDayStart(now)));
  return Number(row?.cents ?? 0);
}

/** The AI jobs one store started today — not counting those refused for credits. */
export async function storeJobsToday(tenantId: string, now = new Date()): Promise<number> {
  const [row] = await unsafeAdminDb().select({ n: sql<string>`count(*)` }).from(aiJobs).where(and(
    eq(aiJobs.tenantId, tenantId), gte(aiJobs.createdAt, riyadhDayStart(now)),
    or(isNull(aiJobs.errorCode), ne(aiJobs.errorCode, 'insufficient_credits')),
  ));
  return Number(row?.n ?? 0);
}

const LABEL: Record<AiJobType, string> = {
  generate_3d: '3D generation', enhance_texture: 'texture enhancement', embed_product: 'product embedding',
  enrich_content: 'content enrichment', quality_check: 'quality checks', convert_format: 'format conversion',
};

/**
 * Before a job exists or is charged: throws if a guardrail says no. `ai_paused` (503) for a paused
 * kind of work or the platform's daily spend; `rate_limited` (429) for the store's daily cap.
 */
export async function assertWithinGuardrails(tenantId: string, type: AiJobType, now = new Date()): Promise<void> {
  const limits = await currentGuardrails();
  if (limits.pausedTypes.includes(type)) {
    throw new AppError('ai_paused', { detail: `${LABEL[type]} is paused for now — nothing was charged; try again later` });
  }
  if (limits.dailySpendCapCents !== null) {
    const spent = await spentTodayCents(now);
    if (spent >= limits.dailySpendCapCents) {
      log.warn('ai daily spend cap reached', { spentCents: spent, capCents: limits.dailySpendCapCents, tenantId, type });
      throw new AppError('ai_paused', { detail: 'AI work is paused until tomorrow — nothing was charged', retryAfter: secondsToTomorrow(now) });
    }
  }
  if (limits.storeDailyJobsCap !== null) {
    const started = await storeJobsToday(tenantId, now);
    if (started >= limits.storeDailyJobsCap) {
      throw new AppError('rate_limited', {
        detail: `this store has started its ${limits.storeDailyJobsCap} AI jobs for today — nothing was charged; try again tomorrow`,
        retryAfter: secondsToTomorrow(now),
      });
    }
  }
}
