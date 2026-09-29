/**
 * P6.16 — connector health: the facts behind `lib/connection-health.ts`, read for one connection
 * inside its store's scope, and the sweep that keeps `store_connections.health_score` current.
 *
 * The connections screen computes health live (`connectionHealth`), so the merchant always sees
 * why. The sweep (every worker tick) stores the score for lists and the Tajribah team, and when a
 * connection gets **worse** — healthy → needs attention → failing — tells the store's people who
 * can see connections, once per worsening (a connection staying unwell is not re-announced; one
 * that recovers and falls again is).
 */
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { storeConnections, syncJobs, webhookEvents, type StoreConnection } from '@/db/schema';
import { HEALTH_LEVELS, HEALTH_REASONS, healthOf, levelOf, type ConnectionHealth, type HealthFacts, type HealthLevel } from '@/lib/connection-health';
import { log } from '@/server/core/observability/log';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { notifyIn } from '@/server/modules/notifications/service';

const DAY = 24 * 3_600_000;
/** How far back "failed in a row" looks — enough to reach the penalty's cap. */
const RECENT_SYNCS = 5;
const RANK: Record<HealthLevel, number> = { healthy: 0, attention: 1, failing: 2 };

export async function healthFactsFor(db: TenantDb, row: StoreConnection, now: Date): Promise<HealthFacts> {
  const recent = await db.find(syncJobs, and(eq(syncJobs.connectionId, row.id), inArray(syncJobs.status, ['done', 'failed'])), { limit: RECENT_SYNCS, orderBy: desc(syncJobs.id) }); // one sync at a time per connection: newest started is newest finished, and (connection_id, id) serves it (P7)
  let failedSyncsInRow = 0;
  for (const job of recent) { if (job.status !== 'failed') break; failedSyncsInRow++; }
  const day = and(eq(webhookEvents.connectionId, row.id), gte(webhookEvents.createdAt, new Date(now.getTime() - DAY)));
  const [processed, failed, waiting] = await Promise.all([
    db.count(webhookEvents, and(day, eq(webhookEvents.status, 'processed'))),
    db.count(webhookEvents, and(day, eq(webhookEvents.status, 'failed'))),
    db.find(webhookEvents, and(eq(webhookEvents.connectionId, row.id), eq(webhookEvents.status, 'received')), { limit: 1, orderBy: asc(webhookEvents.createdAt) }),
  ]);
  return {
    status: row.status, createdAt: row.createdAt, lastSyncAt: row.lastSyncAt, syncIntervalMinutes: row.syncIntervalMinutes,
    failedSyncsInRow, webhooks24h: { processed, failed }, oldestWaitingAt: waiting[0]?.createdAt ?? null,
  };
}

/** Live health for the connections screen. */
export async function connectionHealth(db: TenantDb, row: StoreConnection, now = new Date()): Promise<ConnectionHealth> {
  return healthOf(await healthFactsFor(db, row, now), now);
}

export type HealthSweep = { checked: number; changed: number; alerted: number };

/** Recompute every connection's score; tell a store when one of its connections got worse. */
export async function refreshConnectionHealth(now = new Date(), limit = 1_000): Promise<HealthSweep> {
  const admin = unsafeAdminDb(); // platform sweep across tenants: ids and tenants only
  const rows = await admin.select({ id: storeConnections.id, tenantId: storeConnections.tenantId }).from(storeConnections).orderBy(asc(storeConnections.id)).limit(limit);
  const result: HealthSweep = { checked: 0, changed: 0, alerted: 0 };
  for (const { id, tenantId } of rows) {
    try {
      await withTenant(tenantId, async (db) => {
        const row = await db.lockById(storeConnections, id);
        const health = await connectionHealth(db, row, now);
        result.checked++;
        if (health.score === row.healthScore) return;
        await db.updateById(storeConnections, id, { healthScore: health.score });
        result.changed++;
        const before = levelOf(row.healthScore);
        if (RANK[health.level] <= RANK[before]) return; // better, or the same level: nothing to announce
        const name = row.storeName ?? row.externalStoreId;
        const why = health.reasons.map((r) => HEALTH_REASONS[r]);
        await notifyIn(db, {
          type: 'connection.health', permission: 'connections:read', level: health.level === 'failing' ? 'error' : 'warning', href: '/dashboard/connections',
          title: { ar: `ربط ${name}: ${HEALTH_LEVELS[health.level].ar}`, en: `${name} connection: ${HEALTH_LEVELS[health.level].en}` },
          body: { ar: why.map((w) => w.ar).join(' '), en: why.map((w) => w.en).join(' ') },
        });
        result.alerted++;
        log.warn('connection health worsened', { connectionId: id, tenantId, from: before, to: health.level, score: health.score, reasons: health.reasons });
      });
    } catch (error) {
      // One store never stops the sweep for the rest.
      log.warn('connection health skipped a connection', { connectionId: id, tenantId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
