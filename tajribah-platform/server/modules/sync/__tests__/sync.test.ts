/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { auditLogs, jobs, plans, products, storeConnections, subscriptions, syncJobItems, syncJobs, tenants, type Job } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { planByCode } from '@/lib/plans';
import { clearConnectors, registerConnector } from '@/server/connectors/types';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { clearHandlers, registerHandler, tick } from '@/server/core/jobs/runner';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, enablePlanFeature, seedTenant, type TestDb } from '@/server/testing/harness';
import { FakeStore } from '@/server/testing/fake-store';
import { connectStore, disconnectStore } from '@/server/modules/connections/service';
import { runSyncStep } from '@/server/modules/sync/engine';
import { handleSyncJob } from '@/server/modules/sync/job';
import { latestSync, requestSync, syncProgress } from '@/server/modules/sync/service';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

const code = (e: any) => e.code;
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);

/** A merchant with a connected fake store. `plan: 'enterprise'` lifts the product limit. */
async function merchant(harness: TestDb, name: string, store: FakeStore, plan: 'starter' | 'enterprise' = 'enterprise') {
  const seeded = await seedTenant(harness, name);
  // T35: Salla is Growth and up. The Starter case keeps Starter's 20-product limit and switches Salla on.
  if (plan === 'starter') await enablePlanFeature(harness, 'starter', 'salla');
  if (plan === 'enterprise') {
    const planId = uuidv7();
    const now = new Date();
    await admin(harness, async () => {
      await harness.db.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', nameAr: 'المؤسسات', priceMonthlyMinor: 0, priceAnnualMinor: 0 } as any).onConflictDoNothing();
      const [row] = await harness.db.select().from(plans).where(eq(plans.code, 'enterprise'));
      await harness.db.insert(subscriptions).values({ id: uuidv7(), tenantId: seeded.tenantId, planId: row.id, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) } as any);
    });
  }
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  clearConnectors();
  registerConnector(store);
  const connection = await connectStore(ctx, { provider: 'salla', externalStoreId: `store-${name}`, tokens: { accessToken: 'token' } });
  return { ...seeded, ctx, connectionId: connection.id };
}

/** Run the job queue the way the worker does, until it is empty. Returns the jobs run. */
async function drain(maxPages?: number): Promise<number> {
  clearHandlers();
  registerHandler('sync.products', (job: Job) => handleSyncJob(job, { maxPages }));
  let ran = 0;
  for (;;) {
    const result = await tick('test-worker', 10);
    if (result.claimed === 0) return ran;
    ran += result.claimed;
  }
}

const step = (tenantId: string, syncJobId: string, maxPages?: number, now?: Date) =>
  runSyncStep({ tenantId, syncJobId, requestId: 'req-step', maxPages, now: now ? () => now : undefined });
const productRows = (harness: TestDb, tenantId: string): Promise<any[]> =>
  admin(harness, () => harness.db.select().from(products).where(eq(products.tenantId, tenantId)) as any);
const itemRows = (harness: TestDb, syncJobId: string): Promise<any[]> =>
  admin(harness, () => harness.db.select().from(syncJobItems).where(eq(syncJobItems.syncJobId, syncJobId)) as any);
const connectionRow = async (harness: TestDb, id: string): Promise<any> =>
  (await admin(harness, () => harness.db.select().from(storeConnections).where(eq(storeConnections.id, id))))[0];

test('a full sync of 10,000 products through the worker: short jobs, progress readable, every product once', async () => {
  const harness = await createTestDb();
  try {
    const store = new FakeStore().seed(10_000);
    const { ctx, tenantId, connectionId } = await merchant(harness, 'alpha', store);
    const asked = await requestSync(ctx, connectionId, { type: 'incremental' });
    assert.equal(asked.type, 'full', 'the first sync is full whatever was asked');
    assert.equal(asked.status, 'queued');
    assert.equal(asked.percent, null);

    clearHandlers();
    registerHandler('sync.products', (job: Job) => handleSyncJob(job));
    await tick('test-worker', 10);
    const midway = await syncProgress(ctx, asked.id);
    assert.equal(midway.status, 'running');
    assert.deepEqual([midway.processed, midway.total, midway.percent], [2_000, 10_000, 20], '20 pages of 100 per job');

    const jobsRun = 1 + await drain();
    assert.equal(jobsRun, 5, 'one job per 20 pages');
    const done = await syncProgress(ctx, asked.id);
    assert.deepEqual([done.status, done.processed, done.failed, done.percent], ['done', 10_000, 0, 100]);
    assert.deepEqual(await latestSync(ctx, connectionId), done);

    const rows = await productRows(harness, tenantId);
    assert.equal(rows.length, 10_000);
    assert.equal(new Set(rows.map((r) => r.externalId)).size, 10_000);
    const sample = rows.find((r) => r.externalId === 'p00042');
    assert.deepEqual([sample.name, sample.nameAr, sample.priceMinor, sample.connectionId], ['Product 42', 'منتج 42', 1042, connectionId]);
    assert.equal(store.listCalls.filter((c) => c === null).length, 1, 'the first page was fetched once');
    assert.equal(store.listCalls.length, 100);

    assert.ok((await connectionRow(harness, connectionId)).lastSyncAt, 'the next incremental has a starting point');
    const trail = await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.action, 'sync')));
    const finished = trail.find((r: any) => r.changes?.after?.status === 'done') as any;
    assert.equal(finished.changes.after.created, 10_000);
    assert.equal(finished.actorType, 'system');
    assert.equal(trail.filter((r: any) => r.resourceType === 'product').length, 0, 'no audit row per product');
  } finally { clearConnectors(); await harness.close(); }
});

test('resumable: a store failure mid-sync resumes from the stored cursor, fetching nothing twice', async () => {
  const harness = await createTestDb();
  try {
    const store = new FakeStore().seed(1_000);
    const { ctx, tenantId, connectionId } = await merchant(harness, 'alpha', store);
    const { id } = await requestSync(ctx, connectionId);

    assert.equal((await step(tenantId, id, 3)).result, 'more');
    store.failListCalls = 1;
    await assert.rejects(() => step(tenantId, id, 3), (e: any) => code(e) === 'upstream_unavailable');
    const paused = await syncProgress(ctx, id);
    assert.deepEqual([paused.status, paused.processed], ['running', 300], 'nothing lost, nothing half-applied');

    assert.equal((await step(tenantId, id, 50)).result, 'done');
    assert.deepEqual(store.listCalls.slice(0, 5), [null, 'p00100', 'p00200', 'p00300', 'p00300'], 'the failed page is fetched again, the earlier ones are not');
    assert.equal((await productRows(harness, tenantId)).length, 1_000);
    assert.equal((await itemRows(harness, id)).length, 1_000);
  } finally { clearConnectors(); await harness.close(); }
});

test('idempotent: a page that fails half-way leaves nothing behind, and a duplicate run applies nothing twice', async () => {
  const harness = await createTestDb();
  try {
    const store = new FakeStore().seed(300);
    const { ctx, tenantId, connectionId } = await merchant(harness, 'alpha', store);
    const first = await requestSync(ctx, connectionId);
    await drain();

    const later = new Date('2026-09-10T00:00:00Z');
    store.change('p00050', { name: 'Renamed in Salla' }, later);
    store.change('p00060', { images: [{ url: 'x', alt: BigInt(10) as any }] }, later); // cannot be serialised: throws mid-page
    const second = await requestSync(ctx, connectionId, { type: 'full' });
    await assert.rejects(() => step(tenantId, second.id));
    const products50 = (await productRows(harness, tenantId)).find((r) => r.externalId === 'p00050');
    assert.equal(products50.name, 'Product 50', 'the update before the failure was rolled back with its page');
    assert.equal((await syncProgress(ctx, second.id)).processed, 0);
    assert.equal((await itemRows(harness, second.id)).length, 0);

    store.change('p00060', { images: [] }, later);
    const [a, b] = await Promise.all([step(tenantId, second.id), step(tenantId, second.id)]);
    assert.ok([a.result, b.result].includes('done'));
    const rows = await productRows(harness, tenantId);
    assert.equal(rows.length, 300);
    assert.equal(rows.find((r) => r.externalId === 'p00050').name, 'Renamed in Salla');
    const items = await itemRows(harness, second.id);
    assert.equal(items.length, 300, 'two runs, each page applied once');
    assert.deepEqual(items.filter((i) => i.action === 'updated').map((i) => i.externalId).sort(), ['p00050', 'p00060']);

    assert.equal((await step(tenantId, first.id)).result, 'skipped', 'a finished sync is not run again');
  } finally { clearConnectors(); await harness.close(); }
});

test('incremental: only what changed since the last sync, and the merchant-owned fields survive', async () => {
  const harness = await createTestDb();
  try {
    const store = new FakeStore().seed(500);
    const { ctx, tenantId, connectionId } = await merchant(harness, 'alpha', store);
    await requestSync(ctx, connectionId);
    await drain();

    const target = (await productRows(harness, tenantId)).find((r) => r.externalId === 'p00007');
    await admin(harness, () => harness.db.update(products).set({ dimensions: { widthMm: 40, heightMm: 48 }, arEnabled: true, productType: 'watch' } as any).where(eq(products.id, target.id)));

    const afterFirst = new Date(Date.now() + 60_000);
    store.change('p00007', { priceMinor: 999 }, afterFirst);
    store.change('p00300', { status: 'draft' }, afterFirst);
    store.listCalls.length = 0;
    const inc = await requestSync(ctx, connectionId);
    assert.equal(inc.type, 'incremental');
    await drain();

    const done = await syncProgress(ctx, inc.id);
    assert.deepEqual([done.status, done.total, done.processed], ['done', 2, 2]);
    const row = (await productRows(harness, tenantId)).find((r) => r.id === target.id);
    assert.equal(row.priceMinor, 999);
    assert.deepEqual([row.arEnabled, row.productType, row.dimensions?.widthMm], [true, 'watch', 40], 'sync never touches what the store does not own');
    assert.equal((await productRows(harness, tenantId)).find((r) => r.externalId === 'p00300').status, 'draft');
  } finally { clearConnectors(); await harness.close(); }
});

test('full sync archives what the store removed — but not when most of the catalogue vanished', async () => {
  const harness = await createTestDb();
  try {
    const store = new FakeStore().seed(100);
    const { ctx, tenantId, connectionId } = await merchant(harness, 'alpha', store);
    await requestSync(ctx, connectionId);
    await drain();

    for (const id of ['p00001', 'p00002', 'p00003']) store.products.delete(id);
    await requestSync(ctx, connectionId, { type: 'full' });
    await drain();
    const rows = await productRows(harness, tenantId);
    assert.deepEqual(rows.filter((r) => r.status === 'archived').map((r) => r.externalId).sort(), ['p00001', 'p00002', 'p00003']);
    assert.equal(rows.find((r) => r.externalId === 'p00001').arEnabled, false);

    for (let i = 4; i <= 70; i++) store.products.delete(`p${String(i).padStart(5, '0')}`);
    const suspicious = await requestSync(ctx, connectionId, { type: 'full' });
    await drain();
    assert.equal((await productRows(harness, tenantId)).filter((r) => r.status === 'archived').length, 3, 'nothing more archived');
    assert.match((await syncProgress(ctx, suspicious.id)).error ?? '', /nothing archived/);
    assert.match((await connectionRow(harness, connectionId)).lastError ?? '', /nothing archived/);
  } finally { clearConnectors(); await harness.close(); }
});

test('the plan limit holds, and a bad product fails alone', async () => {
  const harness = await createTestDb();
  try {
    const store = new FakeStore().seed(30);
    store.change('p00003', { currency: 'riyal' }, new Date('2026-09-01T00:00:00Z'));
    store.change('p00004', { priceMinor: -5 }, new Date('2026-09-01T00:00:00Z'));
    store.change('p00005', { priceMinor: 3_000_000_000 }, new Date('2026-09-01T00:00:00Z'));
    const { ctx, tenantId, connectionId } = await merchant(harness, 'alpha', store, 'starter');
    const { id } = await requestSync(ctx, connectionId);
    await drain();

    const limit = planByCode('starter').limits.products;
    const done = await syncProgress(ctx, id);
    assert.equal(done.status, 'done');
    assert.equal((await productRows(harness, tenantId)).length, limit);
    const failed = (await itemRows(harness, id)).filter((i) => i.action === 'failed');
    assert.equal(done.failed, failed.length);
    assert.equal(failed.filter((i) => i.error === `plan limit reached (products: ${limit})`).length, 30 - 3 - limit);
    assert.deepEqual(failed.filter((i) => !i.error.startsWith('plan limit')).map((i) => i.externalId).sort(), ['p00003', 'p00004', 'p00005']);
  } finally { clearConnectors(); await harness.close(); }
});

test('one active sync per store; a disconnected store is refused; a revoked one fails the sync', async () => {
  const harness = await createTestDb();
  try {
    const store = new FakeStore().seed(10);
    const { ctx, tenantId, connectionId } = await merchant(harness, 'alpha', store);
    const [a, b] = await Promise.all([requestSync(ctx, connectionId), requestSync(ctx, connectionId)]);
    assert.equal(a.id, b.id);
    assert.equal(await admin(harness, async () => (await harness.db.select().from(jobs)).length), 1, 'one queue job');

    await disconnectStore(ctx, connectionId);
    const outcome = await step(tenantId, a.id);
    assert.equal(outcome.result, 'failed');
    assert.match((await syncProgress(ctx, a.id)).error ?? '', /reconnect/);
    await assert.rejects(() => requestSync(ctx, connectionId), (e: any) => code(e) === 'conflict');
  } finally { clearConnectors(); await harness.close(); }
});

test('the last queue attempt marks the sync failed instead of leaving it running', async () => {
  const harness = await createTestDb();
  try {
    const store = new FakeStore().seed(10);
    const { ctx, tenantId, connectionId } = await merchant(harness, 'alpha', store);
    const { id } = await requestSync(ctx, connectionId);
    const job = { id: uuidv7(), tenantId, queue: 'sync.products', payload: { syncJobId: id }, attempts: 2, maxAttempts: 5 } as unknown as Job;

    store.failListCalls = 2;
    await assert.rejects(() => handleSyncJob(job));
    assert.equal((await syncProgress(ctx, id)).status, 'running', 'retries left: keep going');
    await assert.rejects(() => handleSyncJob({ ...job, attempts: 5 }));
    const failed = await syncProgress(ctx, id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error ?? '', /unavailable/);
  } finally { clearConnectors(); await harness.close(); }
});

test('another store cannot read or run this store\'s sync; a suspended store does not sync', async () => {
  const harness = await createTestDb();
  try {
    const store = new FakeStore().seed(10);
    const a = await merchant(harness, 'alpha', store);
    const { id } = await requestSync(a.ctx, a.connectionId);
    const b = await merchant(harness, 'beta', new FakeStore());

    await assert.rejects(() => syncProgress(b.ctx, id), (e: any) => code(e) === 'not_found');
    assert.equal((await step(b.tenantId, id)).result, 'skipped', "a job id from another store finds nothing");
    assert.equal((await productRows(harness, b.tenantId)).length, 0);

    await admin(harness, () => harness.db.update(tenants).set({ status: 'suspended' } as any).where(eq(tenants.id, a.tenantId)));
    await assert.rejects(() => step(a.tenantId, id), (e: any) => code(e) === 'forbidden');
    assert.equal((await admin(harness, () => harness.db.select().from(syncJobs).where(and(eq(syncJobs.id, id)))))[0].status, 'queued');
  } finally { clearConnectors(); await harness.close(); }
});
