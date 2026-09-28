/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { jobs, storeConnections, syncJobs, tenants, type Job } from '@/db/schema';
import { clearConnectors, registerConnector } from '@/server/connectors/types';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { clearHandlers, registerHandler, tick } from '@/server/core/jobs/runner';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { FakeStore } from '@/server/testing/fake-store';
import { connectStore, disconnectStore } from '@/server/modules/connections/service';
import { handleSyncJob } from '@/server/modules/sync/job';
import { scheduleSyncs, STALE_AFTER_MS } from '@/server/modules/sync/schedule';
import { syncProgress } from '@/server/modules/sync/service';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);
const MINUTE = 60_000;

async function merchant(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name, { plan: 'growth' }); // T35: store platforms are Growth and up
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  const connection = await connectStore(ctx, { provider: 'salla', externalStoreId: `store-${name}`, tokens: { accessToken: 'token' } });
  return { ...seeded, ctx, connectionId: connection.id };
}
const syncsOf = (harness: TestDb, connectionId: string): Promise<any[]> =>
  admin(harness, () => harness.db.select().from(syncJobs).where(eq(syncJobs.connectionId, connectionId)) as any);
const setConnection = (harness: TestDb, id: string, values: Record<string, unknown>) =>
  admin(harness, () => harness.db.update(storeConnections).set(values as any).where(eq(storeConnections.id, id)));
const setSync = (harness: TestDb, id: string, values: Record<string, unknown>) =>
  admin(harness, () => harness.db.update(syncJobs).set(values as any).where(eq(syncJobs.id, id)));

async function drain() {
  clearHandlers();
  registerHandler('sync.products', (job: Job) => handleSyncJob(job));
  while ((await tick('test-worker', 10)).claimed > 0) { /* until empty */ }
}

test('due stores get one sync per tick; not-due, revoked and busy stores do not', async () => {
  const harness = await createTestDb();
  try {
    registerConnector(new FakeStore().seed(5));
    const fresh = await merchant(harness, 'fresh');
    const due = await merchant(harness, 'due');
    const recent = await merchant(harness, 'recent');
    const gone = await merchant(harness, 'gone');
    const now = new Date();
    await setConnection(harness, due.connectionId, { lastSyncAt: new Date(now.getTime() - 61 * MINUTE) });
    await setConnection(harness, recent.connectionId, { lastSyncAt: new Date(now.getTime() - 10 * MINUTE) });
    await disconnectStore(gone.ctx, gone.connectionId);

    assert.deepEqual(await scheduleSyncs(now), { scheduled: 2, stale: 0 });
    const [first] = await syncsOf(harness, fresh.connectionId);
    const [second] = await syncsOf(harness, due.connectionId);
    assert.deepEqual([first.type, first.triggeredBy], ['full', 'schedule'], 'never synced: full');
    assert.deepEqual([second.type, second.triggeredBy], ['incremental', 'schedule']);
    assert.equal((await syncsOf(harness, recent.connectionId)).length, 0);
    assert.equal((await syncsOf(harness, gone.connectionId)).length, 0);

    assert.deepEqual(await scheduleSyncs(now), { scheduled: 0, stale: 0 }, 'a second tick finds them busy');
    assert.equal((await admin(harness, () => harness.db.select().from(jobs))).length, 2);
  } finally { clearConnectors(); await harness.close(); }
});

test('a store whose sync failed is retried once per interval, not once per tick', async () => {
  const harness = await createTestDb();
  try {
    registerConnector(new FakeStore().seed(5));
    const m = await merchant(harness, 'alpha');
    const now = new Date();
    await scheduleSyncs(now);
    const [sync] = await syncsOf(harness, m.connectionId);
    await setSync(harness, sync.id, { status: 'failed', finishedAt: new Date(now.getTime() - 5 * MINUTE) });

    assert.equal((await scheduleSyncs(now)).scheduled, 0, 'failed 5 minutes ago, interval 60');
    assert.equal((await scheduleSyncs(new Date(now.getTime() + 56 * MINUTE))).scheduled, 1);
  } finally { clearConnectors(); await harness.close(); }
});

test('a stalled sync is re-enqueued once per stall and then finishes', async () => {
  const harness = await createTestDb();
  try {
    registerConnector(new FakeStore().seed(250));
    const m = await merchant(harness, 'alpha');
    const now = new Date();
    await scheduleSyncs(now);
    const [sync] = await syncsOf(harness, m.connectionId);
    // The process died after committing the sync row: its queue job is gone.
    await admin(harness, () => harness.db.delete(jobs));
    await setSync(harness, sync.id, { updatedAt: now });

    assert.equal((await scheduleSyncs(new Date(now.getTime() + 5 * MINUTE))).stale, 0, 'not stale yet at 5 minutes idle');
    const later = new Date(now.getTime() + STALE_AFTER_MS + MINUTE);
    assert.equal((await scheduleSyncs(later)).stale, 1);
    await scheduleSyncs(later);
    assert.equal((await admin(harness, () => harness.db.select().from(jobs))).length, 1, 'seen twice, enqueued once');

    await drain();
    const done = await syncProgress(m.ctx, sync.id);
    assert.deepEqual([done.status, done.processed], ['done', 250]);
  } finally { clearConnectors(); await harness.close(); }
});

test('every tick keeps the coming months of sync_job_items partitions ready', async () => {
  const harness = await createTestDb();
  try {
    const ahead = new Date();
    ahead.setUTCMonth(ahead.getUTCMonth() + 7, 15);
    const name = `sync_job_items_y${ahead.getUTCFullYear()}m${String(ahead.getUTCMonth() + 1).padStart(2, '0')}`;
    const exists = async () => ((await admin(harness, () => harness.db.execute(sql`select to_regclass(${name}) is not null as ok`))) as any).rows[0].ok;
    assert.equal(await exists(), false);
    await scheduleSyncs(ahead);
    assert.equal(await exists(), true);
  } finally { await harness.close(); }
});

test('one suspended store does not stop the tick for the others', async () => {
  const harness = await createTestDb();
  try {
    registerConnector(new FakeStore().seed(5));
    const held = await merchant(harness, 'held');
    const ok = await merchant(harness, 'ok');
    await admin(harness, () => harness.db.update(tenants).set({ status: 'suspended' } as any).where(eq(tenants.id, held.tenantId)));
    assert.equal((await scheduleSyncs(new Date())).scheduled, 1);
    assert.equal((await syncsOf(harness, ok.connectionId)).length, 1);
    assert.equal((await syncsOf(harness, held.connectionId)).length, 0);
  } finally { clearConnectors(); await harness.close(); }
});
