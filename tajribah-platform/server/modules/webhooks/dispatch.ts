/**
 * P1.7 — handling stored webhook events, in the worker.
 *
 * Each event is claimed with `SELECT … FOR UPDATE SKIP LOCKED` inside the transaction that
 * handles it (§13.6): two workers never handle one event, and no `processing` status can be
 * left behind by a crash — a crashed transaction releases its lock and the event is simply
 * `received` again. A handler works in that transaction; anything that must not happen
 * unless it commits (enqueueing a job) is returned as `afterCommit`.
 *
 * A failed handler rolls back, and a second small transaction counts the attempt and sets
 * when the next one may run (the job queue's `backoffMs`). After `MAX_WEBHOOK_ATTEMPTS` the
 * event is `failed` and waits for a person to replay it.
 *
 * Fair like the job queue: in each pass a store gets at most `FAIR_SHARE` of the batch
 * before anyone gets more, so one store's flood cannot hold back another store's update.
 * Slots nobody else wants go to the oldest events left — a store alone still fills the batch.
 */
import { and, asc, eq, isNull, lte, ne, or } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { products, storeConnections, webhookEvents } from '@/db/schema';
import { record } from '@/server/core/audit/audit';
import { backoffMs, FAIR_SHARE } from '@/server/core/jobs/queue';
import { log } from '@/server/core/observability/log';
import { systemContext, type TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { revokeIn } from '@/server/modules/connections/service';
import { createSyncIn, enqueueSync } from '@/server/modules/sync/service';
import { webhookSourceFor, type Delivery } from './sources';
import { notifyIn } from '@/server/modules/notifications/service';

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type HandlerResult = { outcome: 'processed' | 'ignored'; afterCommit?: () => Promise<void> };
/** `entitled` (T35): the store's plan features, read before the transaction — handlers run inside it. */
export type TopicHandler = (event: WebhookEvent, delivery: Delivery, scope: { ctx: TenantContext; db: TenantDb; entitled: (feature: string) => boolean }) => Promise<HandlerResult>;
export type DispatchOutcome = 'processed' | 'ignored' | 'retry' | 'failed' | 'skipped';

export const MAX_WEBHOOK_ATTEMPTS = 5;
export const WEBHOOK_PERMISSIONS = ['connections:read', 'connections:write', 'products:read', 'products:write'] as const;

/** A change on the store's side: catch up with an incremental sync (deduped per store). */
const catchUp: TopicHandler = async (event, _delivery, { ctx, db, entitled }) => {
  const connection = await db.findById(storeConnections, event.connectionId!);
  if (!connection || connection.status !== 'active') return { outcome: 'ignored' };
  if (!entitled(connection.provider)) return { outcome: 'ignored' }; // T35: the platform is no longer in the plan
  const { job, fresh } = await createSyncIn(ctx, db, connection.id, { type: 'incremental', triggeredBy: 'webhook' });
  return { outcome: 'processed', afterCommit: fresh ? () => enqueueSync(ctx.tenantId, job.id) : undefined };
};

export const HANDLERS: Record<string, TopicHandler> = {
  'product.created': catchUp,
  'product.updated': catchUp,

  /** An incremental sync never sees a deletion, so archive it here. */
  'product.deleted': async (event, delivery, { ctx, db }) => {
    if (!delivery.subject) return { outcome: 'ignored' };
    const [before] = await db.find(products, and(
      eq(products.connectionId, event.connectionId!), eq(products.externalId, delivery.subject), ne(products.status, 'archived'),
    ), { limit: 1 });
    if (!before) return { outcome: 'ignored' };
    const after = await db.updateById(products, before.id, { status: 'archived', arEnabled: false, syncedAt: new Date() });
    await record(ctx, { action: 'update', resourceType: 'product', resourceId: before.id, before, after }, db);
    return { outcome: 'processed' };
  },

  'app.uninstalled': async (event, _delivery, { ctx, db }) => {
    await revokeIn(ctx, db, event.connectionId!, 'the app was uninstalled from the store');
    return { outcome: 'processed' };
  },
};

/** One worker pass over events due to be handled: fair across stores, oldest first within. */
export async function dispatchPending(limit = 50, now = new Date()): Promise<Record<DispatchOutcome, number>> {
  // Platform scheduling across tenants, like the job queue: ids and tenants only. Each
  // event is then handled inside its own tenant's RLS transaction.
  const due = await unsafeAdminDb()
    .select({ id: webhookEvents.id, tenantId: webhookEvents.tenantId })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.status, 'received'), or(isNull(webhookEvents.nextAttemptAt), lte(webhookEvents.nextAttemptAt, now))))
    .orderBy(asc(webhookEvents.createdAt))
    .limit(limit * 10);
  const counts: Record<DispatchOutcome, number> = { processed: 0, ignored: 0, retry: 0, failed: 0, skipped: 0 };
  for (const { id, tenantId } of fairBatch(due, limit)) counts[await dispatchOne(tenantId, id, now)] += 1;
  return counts;
}

/** Each tenant's oldest `FAIR_SHARE` first, then the oldest of what is left, up to `limit`. */
export function fairBatch<T extends { tenantId: string }>(oldestFirst: T[], limit: number): T[] {
  const cap = Math.max(1, Math.floor(limit * FAIR_SHARE));
  const taken = new Map<string, number>();
  const first: T[] = [];
  const rest: T[] = [];
  for (const row of oldestFirst) {
    const n = taken.get(row.tenantId) ?? 0;
    if (n < cap) { first.push(row); taken.set(row.tenantId, n + 1); } else rest.push(row);
  }
  return [...first, ...rest].slice(0, limit);
}

export async function dispatchOne(tenantId: string, eventId: string, now = new Date()): Promise<DispatchOutcome> {
  const ctx = await systemContext({ tenantId, requestId: `webhook-${eventId}`, permissions: WEBHOOK_PERMISSIONS });
  let afterCommit: (() => Promise<void>) | undefined;
  try {
    const plan = await entitlementsOf(ctx); // before the transaction: its own handle must not wait inside it
    const outcome = await withTenant(tenantId, async (db): Promise<DispatchOutcome> => {
      const event = await db.tryLockById(webhookEvents, eventId);
      if (!event || event.status !== 'received') return 'skipped';
      const delivery = webhookSourceFor(event.provider)?.parse(event.payload);
      if (!delivery) throw new Error(`no webhook source can read this ${event.provider} delivery`);
      const handler = HANDLERS[event.topic];
      const result: HandlerResult = handler ? await handler(event, delivery, { ctx, db, entitled: (feature) => plan.has(feature) }) : { outcome: 'ignored' };
      await db.updateById(webhookEvents, eventId, { status: result.outcome, attempts: event.attempts + 1, processedAt: new Date(), error: null });
      afterCommit = result.afterCommit;
      return result.outcome;
    });
    if (afterCommit) await afterCommit();
    return outcome;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return withTenant(tenantId, async (db): Promise<DispatchOutcome> => {
      const event = await db.tryLockById(webhookEvents, eventId);
      if (!event || event.status !== 'received') return 'skipped';
      const attempts = event.attempts + 1;
      const spent = attempts >= MAX_WEBHOOK_ATTEMPTS;
      await db.updateById(webhookEvents, eventId, {
        attempts, error: message, status: spent ? 'failed' : 'received',
        nextAttemptAt: spent ? null : new Date(now.getTime() + backoffMs(attempts)),
      });
      if (spent) {
        await notifyIn(db, {
          type: 'webhook.failed', permission: 'connections:read', level: 'warning', href: '/dashboard/connections',
          title: { ar: 'تحديث من متجرك لم يُعالَج', en: 'An update from your store was not processed' },
          body: { ar: `${event.topic}: ${message}`, en: `${event.topic}: ${message}` },
        });
      }
      log.warn('webhook handler failed', { webhookEventId: eventId, topic: event.topic, attempts, spent, error: message });
      return spent ? 'failed' : 'retry';
    });
  }
}
