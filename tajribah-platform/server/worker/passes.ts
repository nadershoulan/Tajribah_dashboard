/**
 * P7 — the passes that run background work, shared by every runtime: the Cloudflare Worker
 * (`entry.ts`: the cron and the `JOBS` consumer, with the Workers-safe handlers) and a Node worker
 * (`main.ts`, with every handler). Each runtime says which handlers it has (`chooseHandlers`), and a
 * pass claims only those queues. A pass drains within a time budget (backpressure): what is left
 * waits for the next pass.
 */
import { and, eq, lte, min } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { jobs } from '@/db/schema';
import { drain, type DrainResult } from '../core/jobs/runner';
import { log } from '../core/observability/log';
import { dispatchPending } from '@/server/modules/webhooks/dispatch';
import { scheduleSyncs } from '@/server/modules/sync/schedule';
import { expireStaleDrafts } from '@/server/modules/models/cleanup';
import { resealConnections } from '@/server/modules/connections/rotation';
import { resealTwoFactorSecrets } from '@/server/modules/auth/two-factor';
import { sweepRetentionHourly } from '@/server/modules/admin/retention';
import { sweepAiJobs, sweepUnconfirmedPhotos } from '@/server/modules/ai-jobs/sweep';
import { resealWebhookSecrets, sweepWebhookDeliveries } from '@/server/modules/outgoing-webhooks/sweep';
import { activateCustomDomains, watchCustomDomains } from '@/server/modules/domains/activation';
import { sendTrialReminders } from '@/server/modules/billing/trial';
import { refreshConnectionHealth } from '@/server/modules/connections/health';

export const WORKER_ID = `worker-${Math.random().toString(36).slice(2, 8)}`;

let register: (() => void) | null = null;
let registered = false;

/** The handlers this runtime can run, registered on its first pass. */
export function chooseHandlers(registrar: () => void): void {
  register = registrar;
}

export function ensureHandlers(): void {
  if (registered) return;
  if (!register) throw new Error('no job handlers chosen for this runtime (chooseHandlers)');
  register();
  registered = true;
}

/**
 * How long one pass may keep starting batches. Kept well inside what a Worker invocation may run,
 * leaving room for the batch in flight to finish; the cron pass also runs the sweeps first.
 */
export const CRON_BUDGET_MS = 20_000;
export const QUEUE_BUDGET_MS = 25_000;
/** The oldest due job older than this at the end of a budget-bound pass is logged as a warning. */
export const LAG_WARN_SECONDS = 120;

/** The Cron Trigger's pass: every sweep (each on its own), then drain the queue. */
export async function runScheduledPass(budgetMs = CRON_BUDGET_MS): Promise<DrainResult> {
  ensureHandlers();
  const started = Date.now();
  await scheduled();
  return pass('cron', Math.max(0, budgetMs - (Date.now() - started)));
}

/** The queue consumer's pass: its messages only say "look now". */
export async function runQueuePass(budgetMs = QUEUE_BUDGET_MS): Promise<DrainResult> {
  ensureHandlers();
  return pass('queue', budgetMs);
}

async function pass(kind: 'cron' | 'queue', budgetMs: number): Promise<DrainResult> {
  const result = await drain({ worker: WORKER_ID, budgetMs, extra: dispatchWebhooks });
  if (result.claimed > 0 || result.extra > 0) log.info('worker pass', { worker: WORKER_ID, kind, ...result });
  if (result.stoppedBy === 'budget') {
    // More due work than one pass could start: the next pass (a message or the minute) continues.
    // A growing lag here is the signal for more consumers (max_concurrency) or a bigger database.
    const lagSeconds = await oldestDueSeconds();
    const fields = { worker: WORKER_ID, kind, lagSeconds, batches: result.batches };
    if (lagSeconds !== null && lagSeconds > LAG_WARN_SECONDS) log.warn('queue behind', fields);
    else log.info('worker pass hit its budget', fields);
  }
  return result;
}

/** Seconds the longest-waiting due job has waited, or null when none is due. */
export async function oldestDueSeconds(now = new Date()): Promise<number | null> {
  const [row] = await unsafeAdminDb().select({ at: min(jobs.runAfter) }).from(jobs).where(and(eq(jobs.state, 'queued'), lte(jobs.runAfter, now)));
  return row?.at ? Math.max(0, Math.round((now.getTime() - new Date(row.at).getTime()) / 1000)) : null;
}

/**
 * The database-driven sweeps: due syncs, abandoned draft uploads, tokens under an old key, retention.
 * Each runs on its own: one that throws is logged and the rest — and the drain after — still run.
 */
export const SWEEPS: [string, () => Promise<unknown>][] = [
  ['schedule syncs', scheduleSyncs],
  ['expire stale drafts', expireStaleDrafts],
  ['reseal connections', resealConnections],
  ['reseal two-factor secrets', resealTwoFactorSecrets],
  ['trial reminders', sendTrialReminders],
  ['retention', sweepRetentionHourly], // A14, T22: data past its retention period
  ['AI jobs', sweepAiJobs], // P3.2: AI jobs never dispatched, or abandoned mid-run
  ['unconfirmed photos', sweepUnconfirmedPhotos], // P3.3: photo uploads never confirmed
  ['connection health', refreshConnectionHealth], // P6.16: health scores, and a word to the store when one worsens
  ['outgoing webhook deliveries', sweepWebhookDeliveries], // P8: deliveries whose queued try was lost
  ['reseal webhook secrets', resealWebhookSecrets], // P8: signing secrets under an old ENCRYPTION_KEY (T16)
  ['custom domains: watch', () => watchCustomDomains()], // T62: each address looked at again every quarter-hour (records gone → shoppers back on Tajribah's address)
  ['custom domains', activateCustomDomains], // T62: stores' own addresses whose records are in place, switched on at the edge
];

export async function scheduled(sweeps = SWEEPS): Promise<number> {
  let failed = 0;
  for (const [name, sweep] of sweeps) {
    try { await sweep(); } catch (error) {
      failed++;
      log.error('sweep failed', { sweep: name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return failed;
}

/** Stored webhook deliveries are handled on the same tick as queue jobs (P1.7). */
export async function dispatchWebhooks(): Promise<number> {
  const counts = await dispatchPending();
  const handled = counts.processed + counts.ignored + counts.retry + counts.failed;
  if (handled > 0) log.info('webhooks dispatched', { worker: WORKER_ID, ...counts });
  return handled;
}

