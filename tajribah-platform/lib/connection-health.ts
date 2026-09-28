/**
 * P6.16 — is a store connection healthy? One rule, used by the scheduled sweep (which stores the
 * score and tells the merchant when it gets worse) and by the connections screen (which shows
 * why). Every signal is one the platform already records; the thresholds are engineering
 * choices, written here once:
 *
 *  - **reconnect** — access revoked or expired: nothing syncs until the merchant reconnects. 0.
 *  - **store_error** — the connection is in error (a refresh the store would not answer). −50.
 *  - **sync_failing** — the latest syncs failed, one after another. −25 each, at most −75.
 *  - **sync_stale** — no good sync for three of its own sync intervals (a new connection counts
 *    from when it was made). −30.
 *  - **webhooks_failing** — at least 3 deliveries failed in 24 hours, and 10% or more. −20.
 *  - **webhooks_backlog** — a delivery has waited more than 15 minutes. −20.
 *
 * 80 and up is healthy, 50–79 needs attention, under 50 is failing.
 */
import type { Bi } from './lang';

export const HEALTH = {
  syncPenalty: 25,
  syncPenaltyMax: 75,
  staleIntervals: 3,
  stalePenalty: 30,
  errorPenalty: 50,
  webhookFailedMin: 3,
  webhookFailedShare: 0.1,
  webhookPenalty: 20,
  backlogMs: 15 * 60_000,
  backlogPenalty: 20,
  healthyFrom: 80,
  attentionFrom: 50,
} as const;

export type HealthReason = 'reconnect' | 'store_error' | 'sync_failing' | 'sync_stale' | 'webhooks_failing' | 'webhooks_backlog';
export type HealthLevel = 'healthy' | 'attention' | 'failing';
export type ConnectionHealth = { score: number; level: HealthLevel; reasons: HealthReason[] };

export type HealthFacts = {
  status: 'active' | 'expired' | 'revoked' | 'error';
  createdAt: Date;
  lastSyncAt: Date | null;
  syncIntervalMinutes: number;
  /** Finished syncs, newest first, that failed before the latest one that succeeded. */
  failedSyncsInRow: number;
  webhooks24h: { processed: number; failed: number };
  /** The oldest delivery still waiting to be handled. */
  oldestWaitingAt: Date | null;
};

export const levelOf = (score: number): HealthLevel =>
  score >= HEALTH.healthyFrom ? 'healthy' : score >= HEALTH.attentionFrom ? 'attention' : 'failing';

export function healthOf(f: HealthFacts, now: Date): ConnectionHealth {
  if (f.status === 'revoked' || f.status === 'expired') return { score: 0, level: 'failing', reasons: ['reconnect'] };
  const reasons: HealthReason[] = [];
  let score = 100;
  if (f.status === 'error') { reasons.push('store_error'); score -= HEALTH.errorPenalty; }
  if (f.failedSyncsInRow > 0) { reasons.push('sync_failing'); score -= Math.min(HEALTH.syncPenaltyMax, f.failedSyncsInRow * HEALTH.syncPenalty); }
  const since = (f.lastSyncAt ?? f.createdAt).getTime();
  if (now.getTime() - since > HEALTH.staleIntervals * f.syncIntervalMinutes * 60_000) { reasons.push('sync_stale'); score -= HEALTH.stalePenalty; }
  const { processed, failed } = f.webhooks24h;
  if (failed >= HEALTH.webhookFailedMin && failed / (processed + failed) >= HEALTH.webhookFailedShare) { reasons.push('webhooks_failing'); score -= HEALTH.webhookPenalty; }
  if (f.oldestWaitingAt && now.getTime() - f.oldestWaitingAt.getTime() > HEALTH.backlogMs) { reasons.push('webhooks_backlog'); score -= HEALTH.backlogPenalty; }
  score = Math.max(0, score);
  return { score, level: levelOf(score), reasons };
}

/** What each reason means to the merchant, and what to do. */
export const HEALTH_REASONS: Record<HealthReason, Bi> = {
  reconnect: { ar: 'انتهى إذن الوصول إلى متجرك — أعد الربط لاستئناف المزامنة.', en: 'Access to your store has ended — reconnect to resume syncing.' },
  store_error: { ar: 'متجرك لا يستجيب لطلب تجديد الوصول. نعيد المحاولة تلقائيًا.', en: 'Your store is not answering our access renewal. We keep retrying.' },
  sync_failing: { ar: 'فشلت آخر مزامنات متجرك على التوالي — منتجاتك قد لا تكون محدّثة.', en: 'Your store’s latest syncs failed one after another — your products may be out of date.' },
  sync_stale: { ar: 'لم تكتمل مزامنة منذ مدة أطول من المعتاد.', en: 'No sync has completed for longer than usual.' },
  webhooks_failing: { ar: 'فشل عدد من تحديثات متجرك الفورية خلال آخر 24 ساعة.', en: 'Several of your store’s live updates failed in the last 24 hours.' },
  webhooks_backlog: { ar: 'تحديثات من متجرك تنتظر أكثر من 15 دقيقة.', en: 'Updates from your store have been waiting over 15 minutes.' },
};

export const HEALTH_LEVELS: Record<HealthLevel, Bi> = {
  healthy: { ar: 'سليم', en: 'Healthy' },
  attention: { ar: 'يحتاج انتباهًا', en: 'Needs attention' },
  failing: { ar: 'متعطّل', en: 'Failing' },
};
