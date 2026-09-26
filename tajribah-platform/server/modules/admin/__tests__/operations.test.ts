/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A11 — platform operations for staff: queue health and lag, stuck and dead jobs, failed and
 * overdue webhook deliveries, key rotation state; retrying a dead job and replaying a failed
 * delivery, each with a reason, through the same status change the system makes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, jobs, staffAudit, storeConnections, users, webhookEvents } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { encryptionKeyId } from '@/server/core/auth/crypto';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { keyRotation, operations, replayDelivery, retryJob } from '@/server/modules/admin/operations';

setLogLevel('error');
const MIN = 60_000;
const STAFF = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });
const KEY = 'k'.repeat(40);
const OLD = 'o'.repeat(40);
const env = (previous?: string) => { resetEnv(); loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: KEY, ...(previous ? { ENCRYPTION_KEY_PREVIOUS: previous } : {}) }); };

const job = (harness: TestDb, fields: Record<string, unknown>) =>
  harness.asAdmin(async () => { const id = uuidv7(); await harness.db.insert(jobs).values({ id, queue: 'sync.products', ...fields } as any); return id; });
const delivery = (harness: TestDb, tenantId: string, fields: Record<string, unknown>) =>
  harness.asAdmin(async () => { const id = uuidv7(); await harness.db.insert(webhookEvents).values({ id, tenantId, provider: 'salla', providerEventId: id, topic: 'product.updated', signatureValid: true, ...fields } as any); return id; });

test('queues, stuck and dead jobs, webhook failures and backlog, as of a moment', async () => {
  env();
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const now = new Date('2026-09-27T12:00:00Z');
    const ago = (ms: number) => new Date(now.getTime() - ms);
    await job(harness, { state: 'queued', runAfter: ago(10 * MIN), tenantId: store.tenantId });
    await job(harness, { state: 'queued', runAfter: ago(2 * MIN) });
    await job(harness, { state: 'queued', runAfter: new Date(now.getTime() + 5 * MIN) }); // a retry's backoff
    const stuck = await job(harness, { state: 'running', claimedBy: 'worker-a', claimedAt: ago(20 * MIN) });
    await job(harness, { state: 'claimed', claimedBy: 'worker-b', claimedAt: ago(1 * MIN) });
    const dead = await job(harness, { queue: 'notify.email', state: 'dead', attempts: 5, lastError: 'provider said 500', finishedAt: ago(30 * MIN), tenantId: store.tenantId });
    await job(harness, { queue: 'notify.email', state: 'done', finishedAt: ago(60 * MIN) });
    await job(harness, { queue: 'edge.publish-config', state: 'queued', runAfter: new Date(now.getTime() + 2 * MIN) }); // only a later one
    await job(harness, { queue: 'notify.email', state: 'done', finishedAt: ago(2 * 24 * 60 * MIN) }); // older than a day

    const failed = await delivery(harness, store.tenantId, { status: 'failed', attempts: 5, error: 'handler threw', createdAt: ago(40 * MIN) });
    await delivery(harness, store.tenantId, { status: 'processed', createdAt: ago(40 * MIN) });
    await delivery(harness, store.tenantId, { status: 'received', createdAt: ago(30 * MIN) }); // never picked up: overdue
    await delivery(harness, store.tenantId, { status: 'received', createdAt: ago(60 * MIN), nextAttemptAt: new Date(now.getTime() + MIN) }); // backing off: fine
    await delivery(harness, store.tenantId, { status: 'received', createdAt: ago(2 * MIN) }); // just arrived: fine

    const ops = await operations(now);
    const sync = ops.queues.find((q) => q.queue === 'sync.products')!;
    assert.deepEqual({ ...sync }, { queue: 'sync.products', ready: 2, scheduled: 1, running: 2, dead: 0, doneLastDay: 0, lagSeconds: 600 });
    const email = ops.queues.find((q) => q.queue === 'notify.email')!;
    assert.deepEqual([email.dead, email.doneLastDay, email.lagSeconds], [1, 1, null]);
    const edge = ops.queues.find((q) => q.queue === 'edge.publish-config')!;
    assert.deepEqual([edge.ready, edge.scheduled, edge.lagSeconds], [0, 1, null], 'a job scheduled for later is not late');
    assert.deepEqual(ops.stuck.map((j) => j.id), [stuck], 'only the claim older than the lease');
    assert.deepEqual(ops.dead.map((j) => [j.id, j.store?.id, j.lastError]), [[dead, store.tenantId, 'provider said 500']]);
    assert.deepEqual(ops.webhooks.lastDay, { received: 3, processed: 1, failed: 1, ignored: 0 });
    assert.deepEqual(ops.webhooks.failed.map((w) => w.id), [failed]);
    assert.equal(ops.webhooks.overdue, 1);
  } finally { await harness.close(); resetEnv(); }
});

test('key rotation: what still needs the previous key, and when it can go', async () => {
  env(OLD);
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const current = await encryptionKeyId(KEY);
    const previous = await encryptionKeyId(OLD);
    const connection = (access: string, refresh: string | null) => harness.asAdmin(() => harness.db.insert(storeConnections).values({
      tenantId: store.tenantId, provider: 'salla', externalStoreId: uuidv7(), accessTokenEncrypted: access, refreshTokenEncrypted: refresh,
    } as any));
    await connection(`v2.${current}.a.b`, `v2.${current}.c.d`);
    await connection(`v2.${current}.a.b`, `v2.${previous}.c.d`); // one of its two tokens still old
    await connection('v1.a.b', null); // before key ids: needs a reseal too
    await harness.asAdmin(() => harness.db.update(users).set({ totpSecretEncrypted: `v2.${previous}.x.y` }).where(eq(users.id, store.userId)));

    const state = await keyRotation();
    assert.deepEqual(state, { currentKeyId: current, previousKeySet: true, pending: { connectionTokens: 2, authenticatorSecrets: 1 }, previousKeyRemovable: false });
    assert.ok(!JSON.stringify(state).includes(KEY) && !JSON.stringify(state).includes(OLD), 'never a key');

    await harness.asAdmin(async () => {
      await harness.db.delete(storeConnections);
      await harness.db.update(users).set({ totpSecretEncrypted: `v2.${current}.x.y` }).where(eq(users.id, store.userId));
    });
    assert.equal((await keyRotation()).previousKeyRemovable, true, 'nothing left under the old key');
    env();
    assert.deepEqual([(await keyRotation()).previousKeySet, (await keyRotation()).previousKeyRemovable], [false, false], 'no previous key: nothing to remove');
  } finally { await harness.close(); resetEnv(); }
});

test('retry a dead job and replay a failed delivery: a reason, the right state only, both trails', async () => {
  env();
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const staff = STAFF(store.userId);
    const now = new Date('2026-09-27T12:00:00Z');
    const dead = await job(harness, { state: 'dead', attempts: 5, lastError: 'boom', finishedAt: now, tenantId: store.tenantId });
    const queued = await job(harness, { state: 'queued' });

    await assert.rejects(() => retryJob(staff, dead, 'no'), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => retryJob(staff, queued, 'not dead at all'), (e: any) => e.code === 'conflict');
    await assert.rejects(() => retryJob(staff, uuidv7(), 'no such job here'), (e: any) => e.code === 'not_found');
    await retryJob(staff, dead, 'provider outage is over', now);
    const [row] = await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.id, dead)));
    assert.deepEqual([row!.state, row!.attempts, row!.runAfter.getTime(), row!.finishedAt], ['queued', 0, now.getTime(), null]);

    const failed = await delivery(harness, store.tenantId, { status: 'failed', attempts: 5, error: 'handler threw' });
    const processed = await delivery(harness, store.tenantId, { status: 'processed' });
    await assert.rejects(() => replayDelivery(staff, processed, 'replay a good one'), (e: any) => e.code === 'conflict');
    await replayDelivery(staff, failed, 'handler fixed in v1.4');
    const [event] = await harness.asAdmin(() => harness.db.select().from(webhookEvents).where(eq(webhookEvents.id, failed)));
    assert.deepEqual([event!.status, event!.attempts, event!.error], ['received', 0, null]);
    const audit = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceType, 'webhook_event')));
    assert.deepEqual(audit.map((a) => [a.actorType, a.actorUserId, a.tenantId]), [['staff', store.userId, store.tenantId]], 'the store sees staff replayed it');

    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.deepEqual(trail.map((r) => [r.action, r.targetId, r.storeId, r.reason]), [
      ['job.retry', dead, store.tenantId, 'provider outage is over'],
      ['webhook.replay', failed, store.tenantId, 'handler fixed in v1.4'],
    ], 'refusals leave no row');
  } finally { await harness.close(); resetEnv(); }
});
