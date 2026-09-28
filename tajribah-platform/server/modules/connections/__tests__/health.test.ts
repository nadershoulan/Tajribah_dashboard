/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P6.16 — connector health: the rule at its edges, and the sweep on a real database — scores
 * stored per connection, one word to the store when a connection gets worse (not while it stays
 * unwell), none when it recovers, and never across stores.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { notifications, storeConnections, syncJobs, webhookEvents } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { HEALTH, healthOf, levelOf, type HealthFacts } from '@/lib/connection-health';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { refreshConnectionHealth } from '@/server/modules/connections/health';
import { connectionDetails } from '@/server/modules/connections/http';

setLogLevel('error');
const NOW = new Date('2026-09-28T12:00:00Z');
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const well: HealthFacts = {
  status: 'active', createdAt: ago(30 * 24 * 60 * MIN), lastSyncAt: ago(30 * MIN), syncIntervalMinutes: 60,
  failedSyncsInRow: 0, webhooks24h: { processed: 40, failed: 0 }, oldestWaitingAt: null,
};
const h = (patch: Partial<HealthFacts>) => healthOf({ ...well, ...patch }, NOW);

test('the rule, at its edges', () => {
  assert.deepEqual(h({}), { score: 100, level: 'healthy', reasons: [] });
  assert.deepEqual(h({ status: 'revoked' }), { score: 0, level: 'failing', reasons: ['reconnect'] });
  assert.deepEqual(h({ status: 'expired', failedSyncsInRow: 3 }), { score: 0, level: 'failing', reasons: ['reconnect'] }, 'reconnect says it all');
  assert.deepEqual(h({ status: 'error' }), { score: 50, level: 'attention', reasons: ['store_error'] });
  assert.deepEqual([h({ failedSyncsInRow: 1 }).score, h({ failedSyncsInRow: 2 }).score, h({ failedSyncsInRow: 5 }).score], [75, 50, 25], '−25 each, at most −75');
  // Stale: three of its own intervals, counted from the last good sync — or from creation if there was none.
  assert.deepEqual(h({ lastSyncAt: ago(3 * 60 * MIN) }).reasons, [], 'exactly three intervals: not yet');
  assert.deepEqual(h({ lastSyncAt: ago(3 * 60 * MIN + 1) }).reasons, ['sync_stale']);
  assert.deepEqual(h({ lastSyncAt: ago(3 * 60 * MIN + 1), syncIntervalMinutes: 1440 }).reasons, [], 'a daily sync is not stale after three hours');
  assert.deepEqual(h({ lastSyncAt: null, createdAt: ago(10 * MIN) }).reasons, [], 'a new connection is not stale');
  assert.deepEqual(h({ lastSyncAt: null, createdAt: ago(4 * 60 * MIN) }).reasons, ['sync_stale'], 'never synced, long after connecting');
  // Webhooks: at least 3 failed, and at least 10%.
  assert.deepEqual(h({ webhooks24h: { processed: 100, failed: 2 } }).reasons, []);
  assert.deepEqual(h({ webhooks24h: { processed: 40, failed: 3 } }).reasons, [], '3 of 43 is under 10%');
  assert.deepEqual(h({ webhooks24h: { processed: 27, failed: 3 } }).reasons, ['webhooks_failing'], '3 of 30 is 10%');
  assert.deepEqual(h({ oldestWaitingAt: ago(15 * MIN) }).reasons, []);
  assert.deepEqual(h({ oldestWaitingAt: ago(15 * MIN + 1) }).reasons, ['webhooks_backlog']);
  const worst = h({ status: 'error', failedSyncsInRow: 5, lastSyncAt: ago(10 * 60 * MIN), webhooks24h: { processed: 0, failed: 9 }, oldestWaitingAt: ago(60 * MIN) });
  assert.deepEqual([worst.score, worst.level, worst.reasons.length], [0, 'failing', 5], 'never below zero');
  assert.deepEqual([levelOf(80), levelOf(79), levelOf(50), levelOf(49)], ['healthy', 'attention', 'attention', 'failing']);
  assert.equal(HEALTH.healthyFrom, 80);
});

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const connectionId = uuidv7();
  await harness.asAdmin(() => harness.db.insert(storeConnections).values({
    id: connectionId, tenantId: seeded.tenantId, provider: 'salla', externalStoreId: `${name}-store`, storeName: `${name} store`,
    status: 'active', lastSyncAt: ago(20 * MIN), createdAt: ago(40 * 24 * 60 * MIN),
  } as any));
  return { ...seeded, connectionId };
}
const failSyncs = (harness: TestDb, s: { tenantId: string; connectionId: string }, n: number, start = 1) => harness.asAdmin(() => harness.db.insert(syncJobs).values(
  Array.from({ length: n }, (_, i) => ({ id: uuidv7(), tenantId: s.tenantId, connectionId: s.connectionId, type: 'incremental', status: 'failed', finishedAt: ago((start + i) * MIN), error: 'store is down' })) as any,
));
const doneSync = (harness: TestDb, s: { tenantId: string; connectionId: string }) => harness.asAdmin(() => harness.db.insert(syncJobs).values({ id: uuidv7(), tenantId: s.tenantId, connectionId: s.connectionId, type: 'incremental', status: 'done', finishedAt: NOW } as any));
const scoreOf = async (harness: TestDb, id: string) => harness.asAdmin(async () => (await harness.db.select().from(storeConnections).where(eq(storeConnections.id, id)))[0]!.healthScore);
const healthNotes = (harness: TestDb, tenantId: string) => harness.asAdmin(() => harness.db.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.type, 'connection.health'))));

test('the sweep stores each score, tells the store once when a connection gets worse, and never across stores', async () => {
  const harness = await createTestDb();
  try {
    const alpha = await store(harness, 'alpha');
    const bravo = await store(harness, 'bravo');
    assert.deepEqual(await refreshConnectionHealth(NOW), { checked: 2, changed: 0, alerted: 0 }, 'both healthy: nothing to write or say');

    // Alpha's syncs start failing: two in a row → 50, needs attention.
    await failSyncs(harness, alpha, 2);
    assert.deepEqual(await refreshConnectionHealth(NOW), { checked: 2, changed: 1, alerted: 1 });
    assert.equal(await scoreOf(harness, alpha.connectionId), 50);
    assert.equal(await scoreOf(harness, bravo.connectionId), 100, 'the other store is untouched');
    const [note] = await healthNotes(harness, alpha.tenantId);
    assert.deepEqual([note!.titleEn, note!.level, note!.href], ['alpha store connection: Needs attention', 'warning', '/dashboard/connections']);
    assert.match(note!.bodyAr!, /فشلت آخر مزامنات/);
    assert.equal((await healthNotes(harness, bravo.tenantId)).length, 0, 'no word to another store');

    // Still unwell at the same level on the next tick: not announced again.
    assert.equal((await refreshConnectionHealth(NOW)).alerted, 0);
    // Worse: a third failure and a waiting backlog → failing, announced as an error.
    await failSyncs(harness, alpha, 1, 0.5); // 30 s ago: newest failure, still before the good sync below
    await harness.asAdmin(() => harness.db.insert(webhookEvents).values({ id: uuidv7(), tenantId: alpha.tenantId, connectionId: alpha.connectionId, provider: 'salla', providerEventId: uuidv7(), topic: 'product.updated', signatureValid: true, status: 'received', createdAt: ago(40 * MIN) } as any));
    assert.equal((await refreshConnectionHealth(NOW)).alerted, 1);
    assert.equal(await scoreOf(harness, alpha.connectionId), 5); // 100 − 75 − 20
    assert.equal((await healthNotes(harness, alpha.tenantId)).at(-1)!.level, 'error');

    // A good sync and the backlog handled: it recovers — stored, not announced.
    await doneSync(harness, alpha);
    await harness.asAdmin(() => harness.db.update(webhookEvents).set({ status: 'processed' } as any).where(eq(webhookEvents.connectionId, alpha.connectionId)));
    assert.deepEqual(await refreshConnectionHealth(NOW), { checked: 2, changed: 1, alerted: 0 });
    assert.equal(await scoreOf(harness, alpha.connectionId), 100);
    assert.equal((await healthNotes(harness, alpha.tenantId)).length, 2);

    // The connections screen shows the same rule, live (the real clock), with its reasons.
    await failSyncs(harness, bravo, 1);
    await harness.asAdmin(() => harness.db.update(storeConnections).set({ lastSyncAt: new Date() } as any).where(eq(storeConnections.id, bravo.connectionId)));
    const ctx = await buildTenantContext({ actor: { userId: bravo.userId, email: bravo.email, isStaff: false }, tenantId: bravo.tenantId, requestId: 'r' });
    const [detail] = await connectionDetails(ctx);
    assert.deepEqual(detail!.health, { score: 75, level: 'attention', reasons: ['sync_failing'] });
  } finally { await harness.close(); }
});

test('a revoked connection is failing at once; a change within the same level is stored but not announced', async () => {
  const harness = await createTestDb();
  try {
    const alpha = await store(harness, 'alpha');
    const bravo = await store(harness, 'bravo');
    await harness.asAdmin(() => harness.db.update(storeConnections).set({ status: 'revoked' } as any).where(eq(storeConnections.id, alpha.connectionId)));
    await failSyncs(harness, bravo, 1);
    const swept = await refreshConnectionHealth(NOW);
    assert.deepEqual(swept, { checked: 2, changed: 2, alerted: 2 });
    assert.deepEqual([await scoreOf(harness, alpha.connectionId), await scoreOf(harness, bravo.connectionId)], [0, 75]);
    assert.match((await healthNotes(harness, alpha.tenantId))[0]!.bodyEn!, /reconnect/);
    // Bravo slips further but stays at "needs attention" (75 → 55): stored, not announced again.
    await harness.asAdmin(() => harness.db.insert(webhookEvents).values({ id: uuidv7(), tenantId: bravo.tenantId, connectionId: bravo.connectionId, provider: 'salla', providerEventId: uuidv7(), topic: 'product.updated', signatureValid: true, status: 'received', createdAt: ago(40 * MIN) } as any));
    assert.deepEqual(await refreshConnectionHealth(NOW), { checked: 2, changed: 1, alerted: 0 });
    assert.equal(await scoreOf(harness, bravo.connectionId), 55);
    assert.equal((await healthNotes(harness, bravo.tenantId)).length, 1);
  } finally { await harness.close(); }
});
