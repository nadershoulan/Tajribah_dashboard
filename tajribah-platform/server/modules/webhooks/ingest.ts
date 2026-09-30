/**
 * P1.7 — receiving a webhook: verify, store once, answer fast. Handling happens later, in
 * the worker (`dispatch.ts`) — stored-then-handled, so a slow or failing handler never
 * makes the provider retry, and nothing received is lost if a handler has a bug.
 *
 * Order matters:
 *  1. **Signature over the raw body, before anything else** is believed — including the
 *     store id in it.
 *  2. **A forged delivery is refused and logged, never stored** (T13). Storing it would put
 *     attacker-chosen rows in the tenant the forger names, and would let a forger claim a
 *     real event id first so the genuine delivery is dropped as a duplicate.
 *  3. **Dedup by the database**: `UNIQUE(provider, provider_event_id)`. A redelivery is a
 *     unique violation, answered 200 so the provider stops retrying.
 *  4. A delivery for a store we do not know (uninstalled, never connected) is answered 200
 *     and dropped: there is no tenant to store it under, and a non-2xx means retries forever.
 */
import { and, eq } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { storeConnections, webhookEvents } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { errors, isUniqueViolation } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';
import { withTenant } from '@/server/core/tenancy/rls';
import { webhookSourceFor } from './sources';

/** Providers' own limits are far below this; anything bigger is not a webhook. */
export const MAX_WEBHOOK_BYTES = 256 * 1024;

export type IngestOutcome =
  | { outcome: 'accepted'; id: string }
  | { outcome: 'duplicate' }
  | { outcome: 'unknown_store' };

export async function ingest(provider: string, rawBody: string, headers: Headers): Promise<IngestOutcome> {
  const source = webhookSourceFor(provider);
  if (!source) throw errors.notFound('webhook source');
  const bytes = new TextEncoder().encode(rawBody).length;
  if (bytes > MAX_WEBHOOK_BYTES) throw errors.validation({ body: [`larger than ${MAX_WEBHOOK_BYTES} bytes`] });

  if (!(await source.verify(rawBody, headers))) {
    log.warn('webhook refused: signature did not verify', { provider, bytes });
    throw errors.unauthenticated('webhook signature did not verify');
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    throw errors.validation({ body: ['not JSON'] });
  }
  const delivery = source.parse(body, headers);
  if (!delivery?.eventId || !delivery.externalStoreId || !delivery.topic) {
    throw errors.validation({ body: ['not a webhook envelope this source understands'] });
  }

  // Which tenant: a platform lookup — the delivery precedes any tenant scope, as a login's
  // membership lookup does. Filtered by the provider and a store id the signature vouched for.
  const [connection] = await unsafeAdminDb()
    .select({ id: storeConnections.id, tenantId: storeConnections.tenantId })
    .from(storeConnections)
    .where(and(eq(storeConnections.provider, source.provider), eq(storeConnections.externalStoreId, delivery.externalStoreId)))
    .limit(1);
  if (!connection) {
    log.info('webhook for an unknown store dropped', { provider, topic: delivery.topic });
    return { outcome: 'unknown_store' };
  }

  const id = uuidv7();
  try {
    await withTenant(connection.tenantId, (db) => db.insert(webhookEvents, {
      id, tenantId: connection.tenantId, connectionId: connection.id, provider: source.provider,
      providerEventId: delivery.eventId, topic: delivery.topic, payload: (source.redact ? source.redact(body) : body) as Record<string, unknown>,
      signatureValid: true, status: 'received',
    }));
  } catch (error) {
    if (isUniqueViolation(error)) {
      log.info('webhook duplicate', { provider, topic: delivery.topic, connectionId: connection.id });
      return { outcome: 'duplicate' };
    }
    throw error;
  }
  log.info('webhook stored', { provider, topic: delivery.topic, webhookEventId: id, tenantId: connection.tenantId });
  return { outcome: 'accepted', id };
}
