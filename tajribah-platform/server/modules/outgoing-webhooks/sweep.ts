/**
 * P8 — the two platform sweeps outgoing webhooks need (the worker's schedule tick):
 *
 *  - **Stranded deliveries.** A delivery waits on a queued try; if that try was lost (the process
 *    died between writing the delivery and queueing it), the delivery would wait forever. Any
 *    delivery still pending well past its time gets a try queued again — keyed by the sweep's
 *    window, so each window queues it once.
 *  - **Signing secrets under an old key** (T16's rotation procedure, like `resealConnections`):
 *    secrets move to `ENCRYPTION_KEY`, so removing `ENCRYPTION_KEY_PREVIOUS` does not silence
 *    every endpoint. Nothing is audited: the same secret under another key.
 *
 * Across tenants by nature: ids and tenants only are read here; each row is written in its tenant.
 */
import { and, asc, eq, lt, notLike } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { webhookDeliveries, webhookEndpoints } from '@/db/schema';
import { decryptSecret, encryptSecret, encryptionKeyId } from '@/server/core/auth/crypto';
import { loadEnv } from '@/server/core/config/env';
import { log } from '@/server/core/observability/log';
import { withTenant } from '@/server/core/tenancy/rls';
import { scheduleDelivery, secretKeys } from './deliver';

/** How long past its time a pending delivery waits before the sweep queues it again. */
export const STRANDED_MS = 15 * 60 * 1000;

export async function sweepWebhookDeliveries(now = new Date(), limit = 500): Promise<number> {
  const stranded = await unsafeAdminDb()
    .select({ id: webhookDeliveries.id, tenantId: webhookDeliveries.tenantId, attempts: webhookDeliveries.attempts })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, 'pending'), lt(webhookDeliveries.nextAttemptAt, new Date(now.getTime() - STRANDED_MS))))
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(limit);
  const window = Math.floor(now.getTime() / STRANDED_MS);
  for (const { id, tenantId, attempts } of stranded) await scheduleDelivery(tenantId, id, attempts, undefined, `:sweep:${window}`);
  if (stranded.length) log.warn('webhook deliveries queued again', { count: stranded.length });
  return stranded.length;
}

export async function resealWebhookSecrets(limit = 100): Promise<{ resealed: number; unreadable: number }> {
  const current = loadEnv().ENCRYPTION_KEY;
  const stale = await unsafeAdminDb()
    .select({ id: webhookEndpoints.id, tenantId: webhookEndpoints.tenantId })
    .from(webhookEndpoints)
    .where(notLike(webhookEndpoints.secretEncrypted, `v2.${await encryptionKeyId(current)}.%`))
    .limit(limit);
  let resealed = 0;
  let unreadable = 0;
  for (const { id, tenantId } of stale) {
    const outcome = await withTenant(tenantId, async (db) => {
      const row = await db.lockById(webhookEndpoints, id);
      const secret = await decryptSecret(row.secretEncrypted, secretKeys(), id);
      if (!secret) return 'unreadable' as const;
      await db.updateById(webhookEndpoints, id, { secretEncrypted: await encryptSecret(secret, current, id) } as never);
      return 'resealed' as const;
    });
    if (outcome === 'resealed') resealed += 1; else unreadable += 1;
  }
  if (resealed || unreadable) log.info('webhook secrets re-sealed', { resealed, unreadable });
  return { resealed, unreadable };
}
