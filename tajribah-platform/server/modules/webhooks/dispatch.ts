/**
 * P1.7 — handling stored webhook events, in the worker.
 *
 * Each event is claimed with `SELECT … FOR UPDATE SKIP LOCKED` inside the transaction that
 * handles it (§13.6): two workers never handle one event, and no `processing` status can be
 * left behind by a crash — a crashed transaction releases its lock and the event is simply
 * `received` again. A handler works in that transaction; anything that must not happen
 * unless it commits (enqueueing a job) is returned as `afterCommit`.
 *
 * A failed handler rolls back, and a second small transaction counts the attempt. After
 * `MAX_WEBHOOK_ATTEMPTS` the event is `failed` and waits for a person to replay it.
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { products, storeConnections, webhookEvents } from '@/db/schema';
import { record } from '@/server/core/audit/audit';
import { log } from '@/server/core/observability/log';
import { systemContext, type TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { revokeIn } from '@/server/modules/connections/service';
import { createSyncIn, enqueueSync } from '@/server/modules/sync/service';
import { webhookSourceFor, type Delivery } from './sources';
import { notifyIn } from '@/server/modules/notifications/service';

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type HandlerResult = { outcome: 'processed' | 'ignored'; afterCommit?: () => Promise<void> };
export type TopicHandler = (event: WebhookEvent, delivery: Delivery, scope: { ctx: TenantContext; db: TenantDb }) => Promise<HandlerResult>;
export type DispatchOutcome = 'processed' | 'ignored' | 'retry' | 'failed' | 'skipped';

export const MAX_WEBHOOK_ATTEMPTS = 5;
export const WEBHOOK_PERMISSIONS = ['connections:read', 'connections:write', 'products:read', 'products:write'] as const;

/** A change on the store's side: catch up with an incremental sync (deduped per store). */
const catchUp: TopicHandler = async (event, _delivery, { ctx, db }) => {
  const connection = await db.findById(storeConnections, event.connectionId!);
  if (!connection || connection.status !== 'active') return { outcome: 'ignored' };
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

/** One worker pass over events waiting to be handled, oldest first. */
export async function dispatchPending(limit = 50): Promise<Record<DispatchOutcome, number>> {
  // Platform scheduling across tenants, like the job queue: ids and tenants only. Each
  // event is then handled inside its own tenant's RLS transaction.
  const pending = await unsafeAdminDb()
    .select({ id: webhookEvents.id, tenantId: webhookEvents.tenantId })
    .from(webhookEvents)
    .where(eq(webhookEvents.status, 'received'))
    .orderBy(asc(webhookEvents.createdAt))
    .limit(limit);
  const counts: Record<DispatchOutcome, number> = { processed: 0, ignored: 0, retry: 0, failed: 0, skipped: 0 };
  for (const { id, tenantId } of pending) counts[await dispatchOne(tenantId, id)] += 1;
  return counts;
}

export async function dispatchOne(tenantId: string, eventId: string): Promise<DispatchOutcome> {
  const ctx = await systemContext({ tenantId, requestId: `webhook-${eventId}`, permissions: WEBHOOK_PERMISSIONS });
  let afterCommit: (() => Promise<void>) | undefined;
  try {
    const outcome = await withTenant(tenantId, async (db): Promise<DispatchOutcome> => {
      const event = await db.tryLockById(webhookEvents, eventId);
      if (!event || event.status !== 'received') return 'skipped';
      const delivery = webhookSourceFor(event.provider)?.parse(event.payload);
      if (!delivery) throw new Error(`no webhook source can read this ${event.provider} delivery`);
      const handler = HANDLERS[event.topic];
      const result: HandlerResult = handler ? await handler(event, delivery, { ctx, db }) : { outcome: 'ignored' };
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
      await db.updateById(webhookEvents, eventId, { attempts, error: message, status: spent ? 'failed' : 'received' });
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
