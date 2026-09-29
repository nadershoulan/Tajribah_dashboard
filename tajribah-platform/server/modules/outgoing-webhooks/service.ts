/**
 * P8 — outgoing webhooks, the store's side: its endpoints (an https address, the events it wants,
 * a signing secret shown once), what was sent to each, a test ping, and sending one again.
 *
 * Enterprise (`public_api`, like API keys) and `api_keys:manage` — integrations are one concern.
 * A read-only store may look, turn an endpoint off and delete it; it may not add, change, rotate
 * or test one (the same rule as keys: stopping something never waits for a plan).
 */
import { desc, eq } from 'drizzle-orm';
import { webhookDeliveries, webhookEndpoints } from '@/db/schema';
import { secret, uuidv7 } from '@/lib/ids';
import type { WebhookDeliveryView, WebhookEndpointView } from '@/lib/view-models';
import { MAX_ENDPOINTS, WEBHOOK_EVENTS, WEBHOOK_SECRET_PREFIX } from '@/lib/webhooks';
import { auditedDelete, auditedInsert, auditedUpdate, record } from '@/server/core/audit/audit';
import { encryptSecret } from '@/server/core/auth/crypto';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { loadEnv } from '@/server/core/config/env';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { safeTarget } from '@/server/modules/embed/check';
import { scheduleDelivery } from './deliver';

type Endpoint = typeof webhookEndpoints.$inferSelect;
type Delivery = typeof webhookDeliveries.$inferSelect;
export type EndpointInput = { url: string; events: string[]; description?: string | null };

export function endpointView(row: Endpoint): WebhookEndpointView {
  return {
    id: row.id, url: row.url, description: row.description, events: row.events, active: row.active,
    disabledReason: row.disabledReason, lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    lastStatus: row.lastStatus, createdAt: row.createdAt.toISOString(),
  };
}

export function deliveryView(row: Delivery): WebhookDeliveryView {
  return {
    id: row.id, eventId: row.eventId, event: row.event, status: row.status, attempts: row.attempts,
    responseStatus: row.responseStatus, error: row.error, nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
  };
}

function checked(input: Partial<EndpointInput>): Partial<EndpointInput> {
  const fields: Record<string, string[]> = {};
  const out: Partial<EndpointInput> = {};
  if (input.url !== undefined) {
    const target = safeTarget(input.url, null);
    if (!target.ok) fields.url = [target.reason];
    else out.url = new URL(input.url.trim()).toString();
  }
  if (input.events !== undefined) {
    const known = WEBHOOK_EVENTS as readonly string[];
    const events = [...new Set(input.events)];
    if (!events.length) fields.events = ['at least one'];
    else if (events.some((e) => !known.includes(e))) fields.events = ['not an event we send'];
    else out.events = known.filter((e) => events.includes(e));
  }
  if (input.description !== undefined) {
    const text = input.description?.trim() ?? '';
    if (text.length > 200) fields.description = ['200 characters at most'];
    out.description = text || null;
  }
  if (Object.keys(fields).length) throw errors.validation(fields);
  return out;
}

function mayChange(ctx: TenantContext): void {
  ctx.require('api_keys:manage');
  if (ctx.readOnly) throw errors.readOnly(ctx.readOnly);
}

async function endpointOf(ctx: TenantContext, id: string): Promise<Endpoint> {
  const row = await ctx.db.findById(webhookEndpoints, id);
  if (!row) throw errors.notFound('webhook_endpoint');
  return row;
}

const newSecret = () => `${WEBHOOK_SECRET_PREFIX}${secret(32)}`;

export async function listEndpoints(ctx: TenantContext): Promise<WebhookEndpointView[]> {
  ctx.require('api_keys:manage');
  return (await ctx.db.find(webhookEndpoints, undefined, { limit: MAX_ENDPOINTS * 2, orderBy: desc(webhookEndpoints.id) })).map(endpointView);
}

/** Add an endpoint; its signing secret is returned this once. */
export async function createEndpoint(ctx: TenantContext, input: EndpointInput): Promise<{ endpoint: WebhookEndpointView; secret: string }> {
  mayChange(ctx);
  assertFeature(await entitlementsOf(ctx), 'public_api');
  const values = checked({ url: input.url, events: input.events, description: input.description ?? null });
  if (await ctx.db.count(webhookEndpoints) >= MAX_ENDPOINTS) throw errors.conflict(`a store keeps at most ${MAX_ENDPOINTS} webhook endpoints`);
  const id = uuidv7();
  const signing = newSecret();
  const row = await auditedInsert(ctx, webhookEndpoints, {
    id, tenantId: ctx.tenantId, ...values,
    secretEncrypted: await encryptSecret(signing, loadEnv().ENCRYPTION_KEY, id), createdBy: ctx.actor.userId,
  }, { resourceType: 'webhook_endpoint' }) as Endpoint;
  return { endpoint: endpointView(row), secret: signing };
}

/**
 * Change an endpoint. Turning one off is allowed while read-only; anything else needs a working
 * store. Turning one back on clears what the platform recorded when it turned it off.
 */
export async function updateEndpoint(ctx: TenantContext, id: string, input: Partial<EndpointInput> & { active?: boolean }): Promise<WebhookEndpointView> {
  const onlyTurningOff = input.active === false && input.url === undefined && input.events === undefined && input.description === undefined;
  if (onlyTurningOff) ctx.require('api_keys:manage'); else mayChange(ctx);
  await endpointOf(ctx, id);
  const values: Record<string, unknown> = { ...checked(input) };
  if (input.active !== undefined) {
    values.active = input.active;
    if (input.active) Object.assign(values, { disabledReason: null, consecutiveFailures: 0 });
  }
  return endpointView(await auditedUpdate(ctx, webhookEndpoints, id, values, { resourceType: 'webhook_endpoint' }) as Endpoint);
}

/** Delete an endpoint and what was sent to it. Allowed while read-only. */
export async function deleteEndpoint(ctx: TenantContext, id: string): Promise<void> {
  ctx.require('api_keys:manage');
  await endpointOf(ctx, id);
  await auditedDelete(ctx, webhookEndpoints, id, { resourceType: 'webhook_endpoint' });
}

/** A new signing secret, returned this once; the old one stops signing at once. */
export async function rotateSecret(ctx: TenantContext, id: string): Promise<{ secret: string }> {
  mayChange(ctx);
  await endpointOf(ctx, id);
  const signing = newSecret();
  await auditedUpdate(ctx, webhookEndpoints, id, { secretEncrypted: await encryptSecret(signing, loadEnv().ENCRYPTION_KEY, id) }, { resourceType: 'webhook_endpoint' });
  return { secret: signing };
}

/** What was sent to an endpoint, newest first. */
export async function listDeliveries(ctx: TenantContext, endpointId: string, limit = 50): Promise<WebhookDeliveryView[]> {
  ctx.require('api_keys:manage');
  await endpointOf(ctx, endpointId);
  return (await ctx.db.find(webhookDeliveries, eq(webhookDeliveries.endpointId, endpointId), { limit, orderBy: desc(webhookDeliveries.id) })).map(deliveryView);
}

/** A `ping` to one endpoint, now — to check the address and the signature before real events. */
export async function sendTest(ctx: TenantContext, endpointId: string, now = new Date()): Promise<WebhookDeliveryView> {
  mayChange(ctx);
  const endpoint = await endpointOf(ctx, endpointId);
  if (!endpoint.active) throw errors.conflict('turn the endpoint on first');
  const eventId = `evt_${uuidv7(now.getTime())}`;
  // A delivery is operational, not a change to the store: written directly, like an AI job's events.
  const row = await withTenant(ctx.tenantId, (db) => db.insert(webhookDeliveries, {
    id: uuidv7(now.getTime()), endpointId, eventId, event: 'ping',
    payload: { id: eventId, type: 'ping', createdAt: now.toISOString(), store: ctx.tenant.slug, data: { endpointId } },
    nextAttemptAt: now,
  } as never)) as Delivery;
  await scheduleDelivery(ctx.tenantId, row.id, 0);
  return deliveryView(row);
}

/** Send a delivery again (a new try of the same event, same event id), whatever became of it. */
export async function redeliver(ctx: TenantContext, deliveryId: string, now = new Date()): Promise<WebhookDeliveryView> {
  mayChange(ctx);
  const delivery = await ctx.db.findById(webhookDeliveries, deliveryId);
  if (!delivery) throw errors.notFound('webhook_delivery');
  const endpoint = await endpointOf(ctx, delivery.endpointId);
  if (!endpoint.active) throw errors.conflict('turn the endpoint on first');
  const row = await withTenant(ctx.tenantId, async (db) => {
    const updated = await db.updateById(webhookDeliveries, deliveryId, {
      status: 'pending', attempts: 0, error: null, responseStatus: null, deliveredAt: null, nextAttemptAt: now,
    } as never);
    await record(ctx, { action: 'update', resourceType: 'webhook_delivery', resourceId: deliveryId, before: { status: delivery.status } as never, after: { status: 'pending', sentAgain: true } as never }, db);
    return updated;
  });
  await scheduleDelivery(ctx.tenantId, deliveryId, 0, undefined, `:again:${now.getTime()}`);
  return deliveryView(row as Delivery);
}
