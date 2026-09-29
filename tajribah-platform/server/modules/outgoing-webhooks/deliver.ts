/**
 * P8 — delivering one event to one endpoint: signed, to a public address only, never following a
 * redirect, within 10 seconds; retried on our own schedule (`RETRY_MINUTES`, about 21 hours);
 * an endpoint whose deliveries keep failing is turned off, and the store is told.
 *
 * The signature (`tajribah-signature: t=<unix>,v1=<hex>`) is HMAC-SHA256 of `"<t>.<body>"` under
 * the endpoint's secret: the receiver recomputes it and compares, and refuses an old `t`.
 */
import { and, eq } from 'drizzle-orm';
import { webhookDeliveries, webhookEndpoints, type Job } from '@/db/schema';
import { DISABLE_AFTER, RETRY_MINUTES, SIGNATURE_HEADER } from '@/lib/webhooks';
import { decryptSecret } from '@/server/core/auth/crypto';
import { loadEnv } from '@/server/core/config/env';
import { enqueue } from '@/server/core/jobs/queue';
import { log } from '@/server/core/observability/log';
import { TenantDb } from '@/server/core/tenancy/tenant-db';
import { isPrivateAddress, safeTarget } from '@/server/modules/embed/check';
import { dohResolver, type Resolver } from '@/server/modules/embed/service';
import { notifyIn } from '@/server/modules/notifications/service';

export const DELIVERY_TIMEOUT_MS = 10_000;

/** Tests swap the network: the request, and the DNS lookup that guards it. */
let send: typeof fetch = (...args) => fetch(...args);
let resolve: Resolver = dohResolver((...args) => fetch(...args));
export function setWebhookNetwork(next: { fetch?: typeof fetch; resolve?: Resolver }): void {
  if (next.fetch) send = next.fetch;
  if (next.resolve) resolve = next.resolve;
}
export function resetWebhookNetwork(): void {
  send = (...args) => fetch(...args);
  resolve = dohResolver((...args) => fetch(...args));
}

const encoder = new TextEncoder();
export async function signature(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`)));
  return `t=${timestamp},v1=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export const secretKeys = () => {
  const env = loadEnv();
  return env.ENCRYPTION_KEY_PREVIOUS ? [env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS] : [env.ENCRYPTION_KEY];
};

/** Queue one try of `deliveryId`, now or at `at`. Keyed by the try, so a repeat enqueue is one job. */
export async function scheduleDelivery(tenantId: string, deliveryId: string, attempt: number, at?: Date, salt = ''): Promise<void> {
  await enqueue({
    queue: 'webhooks.deliver', tenantId, payload: { tenantId, deliveryId }, runAfter: at, maxAttempts: 1,
    dedupeKey: `webhook-delivery:${deliveryId}:${attempt}${salt}`,
  });
}

type Outcome = { ok: true; status: number } | { ok: false; status: number | null; error: string; permanent?: boolean };

async function attempt(url: string, secret: string, body: string, headers: Record<string, string>, now: Date): Promise<Outcome> {
  const target = safeTarget(url, null);
  if (!target.ok) return { ok: false, status: null, error: `not a deliverable address: ${target.reason}`, permanent: true };
  const host = new URL(url).hostname;
  const addresses = await resolve(host);
  if (addresses === null) return { ok: false, status: null, error: 'the address could not be looked up' };
  if (!addresses.length) return { ok: false, status: null, error: 'the address has no records' };
  if (addresses.some(isPrivateAddress)) return { ok: false, status: null, error: 'the address is not public', permanent: true };
  try {
    const response = await send(url, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      headers: { 'content-type': 'application/json', 'user-agent': 'Tajribah-Webhooks/1', ...headers, [SIGNATURE_HEADER]: await signature(secret, Math.floor(now.getTime() / 1000), body) },
      body,
    });
    await response.body?.cancel().catch(() => undefined); // the answer's body is never read
    if (response.status >= 200 && response.status < 300) return { ok: true, status: response.status };
    return { ok: false, status: response.status, error: response.status >= 300 && response.status < 400 ? 'redirects are not followed' : `answered ${response.status}` };
  } catch (error) {
    return { ok: false, status: null, error: error instanceof Error && error.name === 'TimeoutError' ? `no answer within ${DELIVERY_TIMEOUT_MS / 1000} s` : 'could not connect' };
  }
}

/** The job: one try of one delivery. Never throws for a delivery problem — the schedule is ours. */
export async function handleWebhookDelivery(job: Job, now = new Date()): Promise<void> {
  const { tenantId, deliveryId } = job.payload as { tenantId: string; deliveryId: string };
  const db = TenantDb.for(tenantId);
  const delivery = await db.findById(webhookDeliveries, deliveryId);
  if (!delivery || delivery.status !== 'pending') return; // done already, or a repeat of this try
  const endpoint = await db.findById(webhookEndpoints, delivery.endpointId);
  if (!endpoint || !endpoint.active) {
    await db.updateById(webhookDeliveries, delivery.id, { status: 'failed', error: 'the endpoint is turned off', nextAttemptAt: null } as never);
    return;
  }
  const secret = await decryptSecret(endpoint.secretEncrypted, secretKeys(), endpoint.id);
  if (!secret) {
    await db.updateById(webhookDeliveries, delivery.id, { status: 'failed', error: 'the signing secret cannot be opened — rotate it', nextAttemptAt: null } as never);
    return;
  }

  const body = JSON.stringify(delivery.payload);
  const tries = delivery.attempts + 1;
  const outcome = await attempt(endpoint.url, secret, body, { 'tajribah-event': delivery.event, 'tajribah-delivery': delivery.id }, now);

  if (outcome.ok) {
    await db.updateById(webhookDeliveries, delivery.id, { status: 'delivered', attempts: tries, responseStatus: outcome.status, error: null, deliveredAt: now, nextAttemptAt: null } as never);
    await db.updateById(webhookEndpoints, endpoint.id, { consecutiveFailures: 0, lastDeliveryAt: now, lastStatus: outcome.status } as never);
    return;
  }

  const more = !outcome.permanent && tries <= RETRY_MINUTES.length;
  if (more) {
    const next = new Date(now.getTime() + RETRY_MINUTES[tries - 1]! * 60_000);
    await db.updateById(webhookDeliveries, delivery.id, { attempts: tries, responseStatus: outcome.status, error: outcome.error, nextAttemptAt: next } as never);
    await db.updateById(webhookEndpoints, endpoint.id, { lastDeliveryAt: now, lastStatus: outcome.status } as never);
    await scheduleDelivery(tenantId, delivery.id, tries, next);
    return;
  }

  await db.updateById(webhookDeliveries, delivery.id, { status: 'failed', attempts: tries, responseStatus: outcome.status, error: outcome.error, nextAttemptAt: null } as never);
  const failures = endpoint.consecutiveFailures + 1;
  const off = failures >= DISABLE_AFTER;
  // Conditional on still being on, so two deliveries failing together turn it off (and tell the store) once.
  const [changed] = await db.update(webhookEndpoints, and(eq(webhookEndpoints.id, endpoint.id), eq(webhookEndpoints.active, true))!, {
    consecutiveFailures: failures, lastDeliveryAt: now, lastStatus: outcome.status,
    ...(off ? { active: false, disabledReason: `${failures} deliveries in a row failed; the last: ${outcome.error}` } : {}),
  } as never);
  if (off && changed) {
    log.warn('webhook endpoint turned off', { tenantId, endpointId: endpoint.id, failures });
    await notifyIn(db, {
      type: 'webhook_endpoint_off', permission: 'api_keys:manage', level: 'warning', href: '/dashboard/webhooks',
      title: { ar: 'أُوقف عنوان إشعارات لأنه لا يستقبل', en: 'A webhook endpoint was turned off: it stopped answering' },
      body: { ar: `${failures} إرسالًا متتاليًا فشل إلى ${endpoint.url}. أصلحه ثم شغّله من جديد.`, en: `${failures} deliveries in a row to ${endpoint.url} failed. Fix it, then turn it back on.` },
    });
  }
}
