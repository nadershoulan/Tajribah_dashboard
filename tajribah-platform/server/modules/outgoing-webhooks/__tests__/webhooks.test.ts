/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P8 — outgoing webhooks: endpoints only on the plan, only at a public https address, the secret
 * shown once and sealed; an event reaches exactly the endpoints that want it, with one id; a
 * delivery is signed so the receiver can check it, never follows a redirect, never reaches a
 * private address, retries on its schedule and gives up; an endpoint that keeps failing is turned
 * off and the store told once; lost tries are queued again; secrets follow a key rotation.
 */
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { jobs, notifications, planFeatures, tenants, webhookDeliveries, webhookEndpoints } from '@/db/schema';
import { DISABLE_AFTER, RETRY_MINUTES, SIGNATURE_HEADER } from '@/lib/webhooks';
import { decryptSecret } from '@/server/core/auth/crypto';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, enablePlanFeature, seedTenant, type TestDb } from '@/server/testing/harness';
import { handleWebhookDelivery, resetWebhookNetwork, setWebhookNetwork, signature } from '@/server/modules/outgoing-webhooks/deliver';
import { emitEvent } from '@/server/modules/outgoing-webhooks/emit';
import { createEndpoint, deleteEndpoint, listDeliveries, listEndpoints, redeliver, rotateSecret, sendTest, updateEndpoint } from '@/server/modules/outgoing-webhooks/service';
import { resealWebhookSecrets, STRANDED_MS, sweepWebhookDeliveries } from '@/server/modules/outgoing-webhooks/sweep';

setLogLevel('error');
const KEY_A = 'a'.repeat(40);
const KEY_B = 'b'.repeat(40);
const boot = (key = KEY_A, previous?: string) => {
  resetEnv();
  loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: key, ...(previous ? { ENCRYPTION_KEY_PREVIOUS: previous } : {}) });
};
const URL_OK = 'https://erp.example.sa/hooks/tajribah';

async function store(harness: TestDb, name = 'alpha', publicApi = true) {
  const seeded = await seedTenant(harness, name);
  if (publicApi) await enablePlanFeature(harness, 'starter', 'public_api');
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}
const rowsOf = (harness: TestDb, table: any, where?: any) => harness.asAdmin(() => (where ? harness.db.select().from(table).where(where) : harness.db.select().from(table)) as any) as Promise<any[]>;
const deliveryJobs = (harness: TestDb) => rowsOf(harness, jobs, eq(jobs.queue, 'webhooks.deliver'));
const run = (tenantId: string, deliveryId: string, now = new Date()) => handleWebhookDelivery({ payload: { tenantId, deliveryId } } as any, now);

/** A receiver: records what it was sent and answers `status`. */
function receiver(status: number | (() => Response | Promise<Response>) = 200) {
  const got: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    got.push({ url, init });
    return typeof status === 'number' ? new Response(status === 204 ? null : 'ok', { status }) : status();
  }) as unknown as typeof globalThis.fetch;
  return { got, fetch };
}
const publicDns = async () => ['93.184.216.34'];

test('endpoints: only on the plan, only at a public https address, the secret shown once and sealed', async () => {
  boot();
  const harness = await createTestDb();
  try {
    const off = await store(harness, 'alpha', false);
    await assert.rejects(() => createEndpoint(off.ctx, { url: URL_OK, events: ['product.updated'] }), (e: any) => e.code === 'plan_required');
    await enablePlanFeature(harness, 'starter', 'public_api');
    const bad = (input: any, field: string) => assert.rejects(() => createEndpoint(off.ctx, { url: URL_OK, events: ['product.updated'], ...input }),
      (e: any) => e.code === 'validation_failed' && field in e.errors);
    for (const url of ['http://erp.example.sa/h', 'https://localhost/h', 'https://10.0.0.8/h', 'https://erp.example.sa:8443/h', 'https://u:p@erp.example.sa/h', 'not a url']) await bad({ url }, 'url');
    await bad({ events: [] }, 'events');
    await bad({ events: ['order.paid'] }, 'events');

    const { endpoint, secret } = await createEndpoint(off.ctx, { url: URL_OK, events: ['product.updated', 'product.created', 'product.updated'], description: ' ERP ' });
    assert.match(secret, /^whsec_/);
    assert.deepEqual(endpoint.events, ['product.created', 'product.updated'], 'once each, in catalogue order');
    assert.equal(endpoint.description, 'ERP');
    const [row] = await rowsOf(harness, webhookEndpoints, eq(webhookEndpoints.id, endpoint.id));
    assert.ok(!row.secretEncrypted.includes(secret.slice(6)), 'sealed, not stored');
    assert.equal(await decryptSecret(row.secretEncrypted, KEY_A, endpoint.id), secret, 'bound to the endpoint id');
    assert.ok(!JSON.stringify(await listEndpoints(off.ctx)).includes(secret.slice(6)), 'never listed');

    for (let i = 1; i < 10; i++) await createEndpoint(off.ctx, { url: `${URL_OK}/${i}`, events: ['product.updated'] });
    await assert.rejects(() => createEndpoint(off.ctx, { url: URL_OK, events: ['product.updated'] }), (e: any) => e.code === 'conflict');
  } finally { await harness.close(); resetEnv(); }
});

test('an event reaches exactly the endpoints that want it, with one id; none once the store leaves the plan', async () => {
  boot();
  const harness = await createTestDb();
  try {
    const a = await store(harness);
    const b = await store(harness, 'bravo');
    const wants = (await createEndpoint(a.ctx, { url: URL_OK, events: ['product.updated'] })).endpoint;
    const other = (await createEndpoint(a.ctx, { url: `${URL_OK}/2`, events: ['model.published'] })).endpoint;
    const paused = (await createEndpoint(a.ctx, { url: `${URL_OK}/3`, events: ['product.updated'] })).endpoint;
    await updateEndpoint(a.ctx, paused.id, { active: false });
    await createEndpoint(b.ctx, { url: URL_OK, events: ['product.updated'] });

    assert.equal(await emitEvent(a.ctx, 'product.updated', { id: 'p1', name: 'Oyster' }), 1);
    const sent = await rowsOf(harness, webhookDeliveries, eq(webhookDeliveries.tenantId, a.tenantId));
    assert.deepEqual(sent.map((d: any) => d.endpointId), [wants.id]);
    assert.deepEqual(sent[0].payload, { id: sent[0].eventId, type: 'product.updated', createdAt: sent[0].payload.createdAt, store: a.ctx.tenant.slug, data: { id: 'p1', name: 'Oyster' } });
    assert.equal((await deliveryJobs(harness)).length, 1, 'its first try queued');
    void other;

    assert.equal(await emitEvent(a.ctx, 'ai_job.finished', { id: 'j1' }), 0, 'nobody wants it: nothing written');
    await harness.asAdmin(() => harness.db.delete(planFeatures).where(eq(planFeatures.featureKey, 'public_api')));
    assert.equal(await emitEvent(a.ctx, 'product.updated', { id: 'p1' }), 0, 'left the plan: silent');
  } finally { await harness.close(); resetEnv(); }
});

test('a delivery is signed, carries its ids, never follows a redirect, and resets the failure count', async () => {
  boot();
  const harness = await createTestDb();
  try {
    const a = await store(harness);
    const { endpoint, secret } = await createEndpoint(a.ctx, { url: URL_OK, events: ['product.updated'] });
    await harness.asAdmin(() => harness.db.update(webhookEndpoints).set({ consecutiveFailures: 3 } as any).where(eq(webhookEndpoints.id, endpoint.id)));
    await emitEvent(a.ctx, 'product.updated', { id: 'p1' });
    const [delivery] = await rowsOf(harness, webhookDeliveries);
    const net = receiver(204);
    setWebhookNetwork({ fetch: net.fetch, resolve: publicDns });
    const now = new Date('2026-09-29T12:00:00Z');
    await run(a.tenantId, delivery.id, now);

    assert.equal(net.got.length, 1);
    const { url, init } = net.got[0]!;
    assert.equal(url, URL_OK);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    const headers = init.headers as Record<string, string>;
    assert.equal(headers['tajribah-event'], 'product.updated');
    assert.equal(headers['tajribah-delivery'], delivery.id);
    assert.equal(init.body, JSON.stringify(delivery.payload));
    const t = Math.floor(now.getTime() / 1000);
    // What a receiver does, with its own library: HMAC-SHA256 of "<t>.<raw body>" under the secret, hex.
    const expected = createHmac('sha256', secret).update(`${t}.${String(init.body)}`).digest('hex');
    assert.equal(headers[SIGNATURE_HEADER], `t=${t},v1=${expected}`, 'the receiver can recompute it with the secret');
    assert.equal(await signature(secret, t, String(init.body)), `t=${t},v1=${expected}`);
    assert.match(headers[SIGNATURE_HEADER]!, /^t=\d+,v1=[0-9a-f]{64}$/);

    const [after] = await rowsOf(harness, webhookDeliveries, eq(webhookDeliveries.id, delivery.id));
    assert.deepEqual([after.status, after.attempts, after.responseStatus], ['delivered', 1, 204]);
    const [ep] = await rowsOf(harness, webhookEndpoints, eq(webhookEndpoints.id, endpoint.id));
    assert.deepEqual([ep.consecutiveFailures, ep.lastStatus], [0, 204]);

    await run(a.tenantId, delivery.id, now);
    assert.equal(net.got.length, 1, 'a repeat of a done try sends nothing');
  } finally { resetWebhookNetwork(); await harness.close(); resetEnv(); }
});

test('a failing delivery retries on its schedule, then gives up; private addresses and redirects are refused', async () => {
  boot();
  const harness = await createTestDb();
  try {
    const a = await store(harness);
    const { endpoint } = await createEndpoint(a.ctx, { url: URL_OK, events: ['product.updated'] });
    await emitEvent(a.ctx, 'product.updated', { id: 'p1' });
    const [delivery] = await rowsOf(harness, webhookDeliveries);
    setWebhookNetwork({ fetch: receiver(500).fetch, resolve: publicDns });
    const now = new Date('2026-09-29T12:00:00Z');

    await run(a.tenantId, delivery.id, now);
    let [row] = await rowsOf(harness, webhookDeliveries, eq(webhookDeliveries.id, delivery.id));
    assert.deepEqual([row.status, row.attempts, row.responseStatus, row.error], ['pending', 1, 500, 'answered 500']);
    assert.equal(row.nextAttemptAt.getTime(), now.getTime() + RETRY_MINUTES[0] * 60_000);
    const queued = (await deliveryJobs(harness)).find((j: any) => j.dedupeKey === `webhook-delivery:${delivery.id}:1`);
    assert.ok(queued && queued.runAfter.getTime() === row.nextAttemptAt.getTime(), 'the next try, queued for its time');

    await harness.asAdmin(() => harness.db.update(webhookDeliveries).set({ attempts: RETRY_MINUTES.length } as any).where(eq(webhookDeliveries.id, delivery.id)));
    await run(a.tenantId, delivery.id, now);
    [row] = await rowsOf(harness, webhookDeliveries, eq(webhookDeliveries.id, delivery.id));
    assert.deepEqual([row.status, row.attempts, row.nextAttemptAt], ['failed', RETRY_MINUTES.length + 1, null], 'the last try: given up');
    let [ep] = await rowsOf(harness, webhookEndpoints, eq(webhookEndpoints.id, endpoint.id));
    assert.equal(ep.consecutiveFailures, 1);

    // A private address: refused at once, no retry, no request made.
    const net = receiver(200);
    const fresh = async () => { await emitEvent(a.ctx, 'product.updated', { id: 'p2' }); return (await rowsOf(harness, webhookDeliveries, eq(webhookDeliveries.status, 'pending'))).at(-1); };
    const d2 = await fresh();
    setWebhookNetwork({ fetch: net.fetch, resolve: async () => ['93.184.216.34', '10.1.2.3'] });
    await run(a.tenantId, d2.id, now);
    [row] = await rowsOf(harness, webhookDeliveries, eq(webhookDeliveries.id, d2.id));
    assert.deepEqual([row.status, row.error, net.got.length], ['failed', 'the address is not public', 0]);

    // A lookup that fails is worth another try; a redirect is a failure, not followed.
    const d3 = await fresh();
    setWebhookNetwork({ fetch: net.fetch, resolve: async () => null });
    await run(a.tenantId, d3.id, now);
    [row] = await rowsOf(harness, webhookDeliveries, eq(webhookDeliveries.id, d3.id));
    assert.deepEqual([row.status, row.error], ['pending', 'the address could not be looked up']);
    setWebhookNetwork({ fetch: receiver(302).fetch, resolve: publicDns });
    await run(a.tenantId, d3.id, now);
    [row] = await rowsOf(harness, webhookDeliveries, eq(webhookDeliveries.id, d3.id));
    assert.deepEqual([row.status, row.responseStatus, row.error], ['pending', 302, 'redirects are not followed']);

    // No answer in time.
    setWebhookNetwork({ fetch: (async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }) as any, resolve: publicDns });
    await run(a.tenantId, d3.id, now);
    [row] = await rowsOf(harness, webhookDeliveries, eq(webhookDeliveries.id, d3.id));
    assert.equal(row.error, 'no answer within 10 s');
    [ep] = await rowsOf(harness, webhookEndpoints, eq(webhookEndpoints.id, endpoint.id));
    assert.equal(ep.active, true);
  } finally { resetWebhookNetwork(); await harness.close(); resetEnv(); }
});

test(`${DISABLE_AFTER} failed deliveries in a row turn the endpoint off and tell the store once; turning it back on starts clean`, async () => {
  boot();
  const harness = await createTestDb();
  try {
    const a = await store(harness);
    const { endpoint } = await createEndpoint(a.ctx, { url: URL_OK, events: ['product.updated'] });
    await harness.asAdmin(() => harness.db.update(webhookEndpoints).set({ consecutiveFailures: DISABLE_AFTER - 1 } as any).where(eq(webhookEndpoints.id, endpoint.id)));
    await emitEvent(a.ctx, 'product.updated', { id: 'p1' });
    await emitEvent(a.ctx, 'product.updated', { id: 'p2' });
    const both = await rowsOf(harness, webhookDeliveries);
    setWebhookNetwork({ fetch: receiver(200).fetch, resolve: async () => ['127.0.0.1'] });
    await Promise.all(both.map((d: any) => run(a.tenantId, d.id))); // together: both see it on, one turns it off

    const [ep] = await rowsOf(harness, webhookEndpoints, eq(webhookEndpoints.id, endpoint.id));
    assert.equal(ep.active, false);
    assert.match(ep.disabledReason, new RegExp(`^${DISABLE_AFTER} deliveries in a row failed`));
    const told = await rowsOf(harness, notifications, and(eq(notifications.tenantId, a.tenantId), eq(notifications.type, 'webhook_endpoint_off')));
    assert.equal(told.length, 1, 'once, to the one person who manages integrations here');

    await emitEvent(a.ctx, 'product.updated', { id: 'p3' });
    assert.equal((await rowsOf(harness, webhookDeliveries)).length, 2, 'an endpoint that is off gets nothing');
    const back = await updateEndpoint(a.ctx, endpoint.id, { active: true });
    assert.deepEqual([back.active, back.disabledReason], [true, null]);
    const [clean] = await rowsOf(harness, webhookEndpoints, eq(webhookEndpoints.id, endpoint.id));
    assert.equal(clean.consecutiveFailures, 0);
  } finally { resetWebhookNetwork(); await harness.close(); resetEnv(); }
});

test('a test ping, sending again, the delivery list; a read-only store may look, turn off and delete — not add, change, rotate or test', async () => {
  boot();
  const harness = await createTestDb();
  try {
    const a = await store(harness);
    const { endpoint, secret } = await createEndpoint(a.ctx, { url: URL_OK, events: ['product.updated'] });
    const ping = await sendTest(a.ctx, endpoint.id);
    assert.equal(ping.event, 'ping');
    const net = receiver(200);
    setWebhookNetwork({ fetch: net.fetch, resolve: publicDns });
    await run(a.tenantId, ping.id);
    assert.equal(JSON.parse(String(net.got[0]!.init.body)).type, 'ping');
    const again = await redeliver(a.ctx, ping.id);
    assert.deepEqual([again.status, again.attempts], ['pending', 0]);
    await run(a.tenantId, ping.id);
    assert.equal(net.got.length, 2, 'sent again, same event id');
    assert.equal(JSON.parse(String(net.got[1]!.init.body)).id, JSON.parse(String(net.got[0]!.init.body)).id);
    assert.equal((await listDeliveries(a.ctx, endpoint.id))[0]!.status, 'delivered');

    const { secret: rotated } = await rotateSecret(a.ctx, endpoint.id);
    assert.notEqual(rotated, secret);

    await harness.asAdmin(() => harness.db.update(tenants).set({ trialEndsAt: new Date(Date.now() - 86_400_000) } as any).where(eq(tenants.id, a.tenantId)));
    const lapsed = await buildTenantContext({ actor: a.ctx.actor, tenantId: a.tenantId, requestId: 'lapsed' });
    const readOnly = (e: any) => e.code === 'store_read_only';
    assert.equal((await listEndpoints(lapsed)).length, 1);
    await assert.rejects(() => createEndpoint(lapsed, { url: `${URL_OK}/2`, events: ['product.updated'] }), readOnly);
    await assert.rejects(() => updateEndpoint(lapsed, endpoint.id, { events: ['model.published'] }), readOnly);
    await assert.rejects(() => rotateSecret(lapsed, endpoint.id), readOnly);
    await assert.rejects(() => sendTest(lapsed, endpoint.id), readOnly);
    assert.equal((await updateEndpoint(lapsed, endpoint.id, { active: false })).active, false);
    await deleteEndpoint(lapsed, endpoint.id);
    assert.equal((await rowsOf(harness, webhookDeliveries)).length, 0, 'its deliveries go with it');
  } finally { resetWebhookNetwork(); await harness.close(); resetEnv(); }
});

test('a lost try is queued again; secrets move to a new ENCRYPTION_KEY and still sign the same', async () => {
  boot(KEY_A);
  const harness = await createTestDb();
  try {
    const a = await store(harness);
    const { endpoint, secret } = await createEndpoint(a.ctx, { url: URL_OK, events: ['product.updated'] });
    await emitEvent(a.ctx, 'product.updated', { id: 'p1' });
    const [delivery] = await rowsOf(harness, webhookDeliveries);
    await harness.asAdmin(() => harness.db.delete(jobs).where(eq(jobs.queue, 'webhooks.deliver'))); // the try was lost
    const now = new Date(delivery.nextAttemptAt.getTime() + STRANDED_MS + 60_000);
    assert.equal(await sweepWebhookDeliveries(new Date(delivery.nextAttemptAt.getTime() + 60_000)), 0, 'not yet: it may just be busy');
    assert.equal(await sweepWebhookDeliveries(now), 1);
    assert.equal((await deliveryJobs(harness)).length, 1);
    assert.equal(await sweepWebhookDeliveries(now), 1, 'still pending: found again…');
    assert.equal((await deliveryJobs(harness)).length, 1, '…but queued once per window');

    boot(KEY_B, KEY_A);
    assert.deepEqual(await resealWebhookSecrets(), { resealed: 1, unreadable: 0 });
    assert.deepEqual(await resealWebhookSecrets(), { resealed: 0, unreadable: 0 }, 'done: ENCRYPTION_KEY_PREVIOUS can go');
    const [row] = await rowsOf(harness, webhookEndpoints, eq(webhookEndpoints.id, endpoint.id));
    assert.equal(await decryptSecret(row.secretEncrypted, KEY_B, endpoint.id), secret);
  } finally { await harness.close(); resetEnv(); }
});
