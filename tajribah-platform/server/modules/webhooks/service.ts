/**
 * P1.7 — what a merchant (or support) can do with deliveries: see their health, replay one.
 *
 * Replay is a status change back to `received`, not a second processing path (§13.6): the
 * worker handles it exactly as it handled the first delivery. Only deliveries whose
 * signature verified exist in this table (T13), and the check is repeated here so that
 * stays true if that ever changes.
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import { webhookEvents } from '@/db/schema';
import type { WebhookHealth } from '@/lib/view-models';
import { auditedUpdate } from '@/server/core/audit/audit';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';

export async function replayWebhook(ctx: TenantContext, id: string): Promise<void> {
  ctx.require('connections:write');
  const event = await ctx.db.findById(webhookEvents, id);
  if (!event) throw errors.notFound('webhook delivery');
  if (!event.signatureValid) throw errors.conflict('a delivery whose signature failed is never replayed');
  if (event.status === 'received') return; // already waiting for the worker
  await auditedUpdate(ctx, webhookEvents, id, { status: 'received', attempts: 0, error: null, processedAt: null, nextAttemptAt: null },
    { resourceType: 'webhook_event', action: 'update' });
}

/** Deliveries for one connection over the last 24 hours, and the latest failure. */
export async function webhookHealth(ctx: TenantContext, connectionId: string, now = new Date()): Promise<WebhookHealth> {
  ctx.require('connections:read');
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const scope = and(eq(webhookEvents.connectionId, connectionId), gte(webhookEvents.createdAt, since));
  const count = (status: 'received' | 'processed' | 'failed' | 'ignored') =>
    ctx.db.count(webhookEvents, and(scope, eq(webhookEvents.status, status)));
  const [waiting, processed, failed, ignored] = await Promise.all([count('received'), count('processed'), count('failed'), count('ignored')]);
  const [latest] = await ctx.db.find(webhookEvents, eq(webhookEvents.connectionId, connectionId), { limit: 1, orderBy: desc(webhookEvents.createdAt) });
  const [failure] = await ctx.db.find(webhookEvents, and(eq(webhookEvents.connectionId, connectionId), eq(webhookEvents.status, 'failed')), { limit: 1, orderBy: desc(webhookEvents.createdAt) });
  return {
    last24h: { waiting, processed, failed, ignored },
    lastDeliveryAt: latest?.createdAt.toISOString() ?? null,
    lastFailure: failure ? { id: failure.id, topic: failure.topic, error: failure.error, at: failure.createdAt.toISOString() } : null,
  };
}
