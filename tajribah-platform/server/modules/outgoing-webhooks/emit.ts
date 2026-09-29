/**
 * P8 — telling a store's endpoints that something happened: one delivery row per endpoint that
 * wants the event, each queued for its first try. The event has one id for every endpoint, so a
 * receiver can drop a repeat; its `data` is the Public API's v1 shape of the thing.
 *
 * Called after the change it describes has committed. Nothing is sent for a store that has no
 * endpoint wanting it (the common case: one read) or that has left the plan with the Public API
 * (its endpoints stay, silent, until it comes back). A failure here is logged, never thrown: the
 * change the merchant made stands whether or not the announcement could be queued.
 */
import { eq } from 'drizzle-orm';
import { webhookDeliveries, webhookEndpoints } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { MAX_ENDPOINTS, WEBHOOK_EVENTS } from '@/lib/webhooks';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { log } from '@/server/core/observability/log';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { scheduleDelivery } from './deliver';

export type EmittedEvent = (typeof WEBHOOK_EVENTS)[number];

export async function emitEvent(ctx: TenantContext, type: EmittedEvent, data: Record<string, unknown>, now = new Date()): Promise<number> {
  try {
    const endpoints = await withTenant(ctx.tenantId, (db) => db.find(webhookEndpoints, eq(webhookEndpoints.active, true), { limit: MAX_ENDPOINTS * 2 }));
    const wanting = endpoints.filter((endpoint) => endpoint.events.includes(type));
    if (!wanting.length) return 0;
    if (!(await entitlementsOf(ctx)).has('public_api')) return 0;

    const eventId = `evt_${uuidv7(now.getTime())}`;
    const payload = { id: eventId, type, createdAt: now.toISOString(), store: ctx.tenant.slug, data };
    const values = wanting.map((endpoint) => ({
      id: uuidv7(now.getTime()), tenantId: ctx.tenantId, endpointId: endpoint.id, eventId, event: type, payload, nextAttemptAt: now,
    })) satisfies (typeof webhookDeliveries.$inferInsert)[];
    const rows = await withTenant(ctx.tenantId, (db) => db.insert(webhookDeliveries, values));
    for (const row of rows) await scheduleDelivery(ctx.tenantId, row.id, 0);
    return rows.length;
  } catch (error) {
    log.error('webhook event not queued', { tenantId: ctx.tenantId, type, error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
}
