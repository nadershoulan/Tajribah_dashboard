/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, jobs, products, storeConnections, subscriptions, syncJobs, webhookEvents } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { clearConnectors, registerConnector } from '@/server/connectors/types';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { FakeStore } from '@/server/testing/fake-store';
import { connectStore } from '@/server/modules/connections/service';
import { dispatchOne, dispatchPending, HANDLERS, MAX_WEBHOOK_ATTEMPTS } from '@/server/modules/webhooks/dispatch';
import { backoffMs } from '@/server/core/jobs/queue';
import { receiveWebhookHandler } from '@/server/modules/webhooks/http';
import { replayWebhook, webhookHealth } from '@/server/modules/webhooks/service';
import { clearWebhookSources, hmacSha256, hmacSource, registerWebhookSource, toHex } from '@/server/modules/webhooks/sources';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

const SECRET = 'whsec-test';
const HEADER = 'x-test-signature';
clearWebhookSources();
registerWebhookSource(hmacSource({
  provider: 'salla', secret: SECRET, header: HEADER,
  parse: (body: any) => (body && typeof body === 'object'
    ? { eventId: String(body.id ?? ''), topic: String(body.event ?? ''), externalStoreId: String(body.store ?? ''), subject: body.product ?? null }
    : null),
}));

const code = (e: any) => e.code;
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);
const sign = async (raw: string, secret = SECRET) => toHex(await hmacSha256(secret, raw));

/** POST a delivery. `raw` is sent byte for byte; `signature` defaults to a valid one over it. */
async function deliver(raw: string, options: { signature?: string | null; provider?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const signature = options.signature === undefined ? await sign(raw) : options.signature;
  if (signature !== null) headers[HEADER] = signature;
  const response = await receiveWebhookHandler(new Request(`http://localhost:5173/api/webhooks/${options.provider ?? 'salla'}`, { method: 'POST', headers, body: raw }));
  return { status: response.status, body: await response.json() as any };
}
const envelope = (fields: Record<string, unknown>) => JSON.stringify({ id: uuidv7(), store: 'store-alpha', event: 'product.updated', ...fields });

async function merchant(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name, { plan: 'growth' }); // T35: store platforms are Growth and up
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  clearConnectors();
  registerConnector(new FakeStore().seed(3));
  const connection = await connectStore(ctx, { provider: 'salla', externalStoreId: `store-${name}`, tokens: { accessToken: 'token' } });
  return { ...seeded, ctx, connectionId: connection.id };
}
const events = (harness: TestDb): Promise<any[]> => admin(harness, () => harness.db.select().from(webhookEvents) as any);

test('a signed delivery is stored as it came; a forged or unsigned one is refused and stored nowhere', async () => {
  const harness = await createTestDb();
  try {
    await merchant(harness, 'alpha');
    const raw = envelope({ product: 'p00001' });
    const accepted = await deliver(raw);
    assert.deepEqual([accepted.status, accepted.body.outcome], [202, 'accepted']);
    const [row] = await events(harness);
    assert.deepEqual([row.status, row.topic, row.signatureValid, row.payload.product], ['received', 'product.updated', true, 'p00001']);

    assert.equal((await deliver(envelope({}), { signature: await sign('something else') })).status, 401);
    assert.equal((await deliver(envelope({}), { signature: await sign(envelope({}), 'wrong-secret') })).status, 401);
    assert.equal((await deliver(envelope({}), { signature: null })).status, 401);
    assert.equal((await deliver(envelope({}), { signature: 'zz' })).status, 401, 'malformed header is a failed check, not a crash');
    assert.equal((await events(harness)).length, 1, 'refused deliveries leave no row');
  } finally { await harness.close(); }
});

test('the signature is checked over the raw bytes, not re-serialised JSON', async () => {
  const harness = await createTestDb();
  try {
    await merchant(harness, 'alpha');
    const pretty = JSON.stringify({ id: uuidv7(), store: 'store-alpha', event: 'product.updated' }, null, 2);
    assert.equal((await deliver(pretty)).status, 202, 'signed over exactly what was sent: accepted, whitespace and all');
    const compact = JSON.stringify(JSON.parse(pretty));
    assert.equal((await deliver(pretty, { signature: await sign(compact) })).status, 401, 'a signature over the parsed-and-reserialised body is not the one that was sent');
  } finally { await harness.close(); }
});

test('a redelivery is a duplicate; a forger cannot claim a real event id first', async () => {
  const harness = await createTestDb();
  try {
    await merchant(harness, 'alpha');
    const raw = envelope({});
    assert.equal((await deliver(raw)).status, 202);
    const again = await deliver(raw);
    assert.deepEqual([again.status, again.body.outcome], [200, 'duplicate'], '2xx so the store stops retrying');
    assert.equal((await events(harness)).length, 1);

    const realId = uuidv7();
    const genuine = envelope({ id: realId });
    assert.equal((await deliver(genuine, { signature: await sign(genuine, 'attacker') })).status, 401);
    assert.equal((await deliver(genuine)).body.outcome, 'accepted', 'the genuine delivery was not squatted');
  } finally { await harness.close(); }
});

test('unknown store, unknown provider, oversized and malformed bodies', async () => {
  const harness = await createTestDb();
  try {
    await merchant(harness, 'alpha');
    const orphan = await deliver(envelope({ store: 'never-connected' }));
    assert.deepEqual([orphan.status, orphan.body.outcome], [200, 'unknown_store']);
    assert.equal((await deliver(envelope({}), { provider: 'zid' })).status, 404);
    assert.equal((await deliver(JSON.stringify({ id: 'x', store: 'store-alpha', event: 'e', pad: 'x'.repeat(300_000) }))).status, 422);
    assert.equal((await deliver('{not json')).status, 422, 'signed but not JSON');
    assert.equal((await deliver(JSON.stringify({ store: 'store-alpha', event: 'product.updated' }))).status, 422, 'no event id: nothing to dedup on');
    assert.equal((await events(harness)).length, 0);
  } finally { await harness.close(); }
});

test('handled in the worker: product changes queue one sync, deletions archive, uninstall revokes, the rest is ignored', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, connectionId } = await merchant(harness, 'alpha');
    const [kept] = await admin(harness, () => harness.db.insert(products).values({ tenantId, connectionId, externalId: 'p00002', name: 'Soon gone', arEnabled: true } as any).returning()) as any[];

    await deliver(envelope({ event: 'product.updated', product: 'p00001' }));
    await deliver(envelope({ event: 'product.created', product: 'p00009' }));
    await deliver(envelope({ event: 'product.deleted', product: 'p00002' }));
    await deliver(envelope({ event: 'order.created' }));
    const counts = await dispatchPending();
    assert.deepEqual([counts.processed, counts.ignored, counts.failed], [3, 1, 0]);

    const syncs = await admin(harness, () => harness.db.select().from(syncJobs)) as any[];
    assert.equal(syncs.length, 1, 'two product events, one sync');
    assert.equal(syncs[0].triggeredBy, 'webhook');
    assert.equal((await admin(harness, () => harness.db.select().from(jobs))).length, 1, 'enqueued after the handling transaction committed');

    const gone = (await admin(harness, () => harness.db.select().from(products).where(eq(products.id, kept.id))))[0] as any;
    assert.deepEqual([gone.status, gone.arEnabled], ['archived', false]);
    const trail = await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceId, kept.id))) as any[];
    assert.equal(trail[0]?.actorType, 'system');

    await deliver(envelope({ event: 'app.uninstalled' }));
    await dispatchPending();
    const connection = (await admin(harness, () => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connectionId))))[0] as any;
    assert.deepEqual([connection.status, connection.accessTokenEncrypted], ['revoked', null]);

    assert.equal((await dispatchPending()).processed, 0, 'nothing handled twice');
    assert.deepEqual((await webhookHealth(ctx, connectionId)).last24h, { waiting: 0, processed: 4, failed: 0, ignored: 1 });
  } finally { clearConnectors(); await harness.close(); }
});

test('a failing handler is retried, then failed; a person replays it; a forged row is never replayable', async () => {
  const harness = await createTestDb();
  let broken = true;
  HANDLERS['test.flaky'] = async () => { if (broken) throw new Error('handler bug'); return { outcome: 'processed' }; };
  try {
    const { ctx, tenantId, connectionId } = await merchant(harness, 'alpha');
    await deliver(envelope({ event: 'test.flaky' }));
    const [event] = await events(harness);

    for (let i = 1; i < MAX_WEBHOOK_ATTEMPTS; i++) assert.equal(await dispatchOne(tenantId, event.id), 'retry');
    assert.equal(await dispatchOne(tenantId, event.id), 'failed');
    const failed = (await events(harness))[0];
    assert.deepEqual([failed.status, failed.attempts, failed.error], ['failed', MAX_WEBHOOK_ATTEMPTS, 'handler bug']);
    assert.equal((await webhookHealth(ctx, connectionId)).lastFailure?.id, event.id);

    broken = false;
    await replayWebhook(ctx, event.id);
    assert.equal((await events(harness))[0].status, 'received');
    assert.equal((await dispatchPending()).processed, 1, 'the same path as a first delivery');

    const forged = uuidv7();
    await admin(harness, () => harness.db.insert(webhookEvents).values({ id: forged, tenantId, connectionId, provider: 'salla', providerEventId: 'forged-1', topic: 'product.updated', signatureValid: false, status: 'failed' } as any));
    await assert.rejects(() => replayWebhook(ctx, forged), (e: any) => code(e) === 'conflict');

    const other = await merchant(harness, 'beta');
    await assert.rejects(() => replayWebhook(other.ctx, event.id), (e: any) => code(e) === 'not_found');
  } finally { delete HANDLERS['test.flaky']; clearConnectors(); await harness.close(); }
});

test('a failed attempt waits before the next one, longer each time; a replay goes straight back', async () => {
  const harness = await createTestDb();
  HANDLERS['test.down'] = async () => { throw new Error('still down'); };
  try {
    const { ctx } = await merchant(harness, 'alpha');
    await deliver(envelope({ event: 'test.down' }));
    const t0 = new Date();
    assert.equal((await dispatchPending(50, t0)).retry, 1);
    assert.equal((await dispatchPending(50, t0)).retry, 0, 'not again on the very next tick');
    const first = (await events(harness))[0];
    const wait1 = first.nextAttemptAt.getTime() - t0.getTime();
    assert.equal(wait1, backoffMs(1));

    const t1 = new Date(first.nextAttemptAt.getTime());
    assert.equal((await dispatchPending(50, t1)).retry, 1, 'due again once the wait is over');
    const second = (await events(harness))[0];
    assert.ok(second.nextAttemptAt.getTime() - t1.getTime() > wait1, 'and the next wait is longer');

    await admin(harness, () => harness.db.update(webhookEvents).set({ status: 'failed' } as any).where(eq(webhookEvents.id, first.id)));
    await replayWebhook(ctx, first.id);
    assert.equal((await events(harness))[0].nextAttemptAt, null, 'a person asked: no waiting');
    assert.equal((await dispatchPending(50, t1)).retry, 1);
  } finally { delete HANDLERS['test.down']; clearConnectors(); await harness.close(); }
});

test('one store\'s flood does not hold back another store\'s update; a lone store still fills the batch', async () => {
  const harness = await createTestDb();
  try {
    await merchant(harness, 'alpha');
    for (let i = 0; i < 10; i++) await deliver(envelope({ event: 'order.created' }));
    await merchant(harness, 'beta');
    await deliver(envelope({ event: 'order.created', store: 'store-beta' }));

    assert.equal((await dispatchPending(5)).ignored, 5, 'the batch is full');
    const waiting = (await events(harness)).filter((e) => e.status === 'received');
    const tenants = new Set(waiting.map((e) => e.tenantId));
    assert.equal(waiting.length, 6);
    assert.equal(tenants.size, 1, 'beta\'s one event went in the first batch, though ten of alpha\'s are older');
  } finally { clearConnectors(); await harness.close(); }
});

test('two workers on one event: it is handled once', async () => {
  const harness = await createTestDb();
  let calls = 0;
  HANDLERS['test.count'] = async () => { calls += 1; return { outcome: 'processed' }; };
  try {
    const { tenantId } = await merchant(harness, 'alpha');
    await deliver(envelope({ event: 'test.count' }));
    const [event] = await events(harness);
    const outcomes = await Promise.all([dispatchOne(tenantId, event.id), dispatchOne(tenantId, event.id)]);
    assert.deepEqual(outcomes.sort(), ['processed', 'skipped']);
    assert.equal(calls, 1);
  } finally { delete HANDLERS['test.count']; clearConnectors(); await harness.close(); }
});

test('T35: a store whose plan no longer has its platform — its product updates are ignored, no sync starts', async () => {
  const harness = await createTestDb();
  try {
    const { tenantId } = await merchant(harness, 'alpha');
    await admin(harness, () => harness.db.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId))); // back on Starter
    await deliver(envelope({ event: 'product.updated', product: 'p00001' }));
    const counts = await dispatchPending();
    assert.deepEqual([counts.processed, counts.ignored], [0, 1]);
    assert.equal((await admin(harness, () => harness.db.select().from(syncJobs)) as any[]).length, 0);
  } finally { await harness.close(); }
});
