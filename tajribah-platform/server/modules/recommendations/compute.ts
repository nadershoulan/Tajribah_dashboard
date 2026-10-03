/**
 * Recommendations, first version — products often viewed together (your choice 2026-10-03: no AI;
 * the plan's embeddings, P6.1–P6.3, need a provider). Nightly per store, from the analytics events:
 * two products are related by the visits that looked at both — a product view, AR or the try-on —
 * in the last 30 days. Each product keeps its top four, and only pairs at least three visits share:
 * fewer is chance, not a pattern. A visit's id is salted daily (P4.1), so "together" means in one
 * visit on one day — which is what a shopper comparing two products looks like.
 *
 * Recomputed whole each night inside the store's row-level-security transaction (no counting up), so a
 * run twice writes the same rows. When a store's pairs change, its published configs are refreshed:
 * the product pages (P1.19) show them on Pro and up (`recommendations`).
 */
import { and, eq, gte, gt, lt, or, isNull, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { dailyTenantStats, relationRuns } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { riyadhDay } from '@/lib/format';
import { log } from '@/server/core/observability/log';
import { withTenantSql } from '@/server/core/tenancy/rls';
import { enqueueEdgeRefresh } from '@/server/modules/edge/publish';

export const WINDOW_DAYS = 30;
export const TOP = 4;
export const MIN_SESSIONS = 3;
/** The nightly pass starts at this Riyadh hour — after the day's last roll-ups. */
export const RUN_HOUR_RIYADH = 3;
const DAY = 86_400_000;

const rowsOf = (result: unknown): Record<string, unknown>[] =>
  (Array.isArray(result) ? result : ((result as { rows?: unknown[] } | null)?.rows ?? [])) as Record<string, unknown>[];

/** Recompute one store's pairs. Returns how many it keeps and whether anything changed. */
export async function computeRelations(tenantId: string, now = new Date()): Promise<{ pairs: number; changed: boolean }> {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  return withTenantSql(tenantId, async (tx) => {
    // RLS keeps this to the store; the filters say so too (the repo's rule: no tenant-scoped query without one).
    const before = rowsOf(await tx.execute(sql`SELECT product_id, related_product_id, rank FROM product_relations WHERE tenant_id = ${tenantId} ORDER BY product_id, rank`));
    const fresh = rowsOf(await tx.execute(sql`
      WITH seen AS (
        SELECT DISTINCT e.session_id, e.product_id
        FROM analytics_events e
        JOIN products p ON p.id = e.product_id AND p.tenant_id = ${tenantId} AND p.deleted_at IS NULL AND p.status <> 'archived'
        WHERE e.tenant_id = ${tenantId} AND e.occurred_at >= ${since} AND e.occurred_at < ${now}
          AND e.event_type IN ('product_view', 'ar_open', 'tryon_start')
      ), pairs AS (
        SELECT a.product_id, b.product_id AS related_product_id, count(*)::int AS sessions
        FROM seen a JOIN seen b ON a.session_id = b.session_id AND a.product_id <> b.product_id
        GROUP BY 1, 2
        HAVING count(*) >= ${MIN_SESSIONS}
      ), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY product_id ORDER BY sessions DESC, related_product_id) AS rank FROM pairs
      )
      SELECT product_id, related_product_id, sessions, rank::int AS rank FROM ranked WHERE rank <= ${TOP}
      ORDER BY product_id, rank`));
    const key = (r: Record<string, unknown>) => `${r.product_id}>${r.related_product_id}#${r.rank}`;
    const changed = before.map(key).join('|') !== fresh.map(key).join('|');
    await tx.execute(sql`DELETE FROM product_relations WHERE tenant_id = ${tenantId}`);
    for (const r of fresh) {
      await tx.execute(sql`INSERT INTO product_relations (id, tenant_id, product_id, related_product_id, sessions, rank, computed_at)
        VALUES (${uuidv7()}, ${tenantId}, ${r.product_id as string}, ${r.related_product_id as string}, ${r.sessions as number}, ${r.rank as number}, ${now})`);
    }
    return { pairs: fresh.length, changed };
  });
}

/**
 * The nightly pass (in the minute's sweeps): from 03:00 Riyadh, each store with views in the window
 * whose relations were not computed today is claimed, then computed. Claimed first, so two passes at
 * once compute a store once; a store that fails is tried again tomorrow.
 */
export async function refreshRelations(now = new Date(), limit = 25): Promise<{ computed: number; failed: number }> {
  const today = riyadhDay(now);
  const riyadhHour = new Date(now.getTime() + 3 * 3_600_000).getUTCHours();
  if (riyadhHour < RUN_HOUR_RIYADH) return { computed: 0, failed: 0 };
  const since = riyadhDay(new Date(now.getTime() - WINDOW_DAYS * DAY));
  const db = unsafeAdminDb(); // a platform sweep: which stores had visits, and which were done today
  const due = await db.selectDistinct({ tenantId: dailyTenantStats.tenantId }).from(dailyTenantStats)
    .leftJoin(relationRuns, eq(relationRuns.tenantId, dailyTenantStats.tenantId))
    .where(and(gte(dailyTenantStats.day, since), gt(dailyTenantStats.views, 0), or(isNull(relationRuns.day), lt(relationRuns.day, today))))
    .limit(limit);
  const result = { computed: 0, failed: 0 };
  for (const { tenantId } of due) {
    try {
      const claimed = await db.insert(relationRuns).values({ tenantId, day: today, computedAt: now })
        .onConflictDoUpdate({ target: relationRuns.tenantId, set: { day: today, computedAt: now }, setWhere: lt(relationRuns.day, today) })
        .returning({ tenantId: relationRuns.tenantId });
      if (!claimed.length) continue;
      const { pairs, changed } = await computeRelations(tenantId, now);
      await db.update(relationRuns).set({ pairs }).where(eq(relationRuns.tenantId, tenantId));
      if (changed) await enqueueEdgeRefresh(tenantId); // product pages show them
      result.computed += 1;
    } catch (error) {
      result.failed += 1;
      log.warn('relations not computed', { tenantId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (result.computed) log.info('relations computed', result);
  return result;
}
