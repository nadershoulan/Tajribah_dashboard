/**
 * P4.3 — the roll-ups: one store's one Riyadh day, recomputed whole from its raw events into the
 * four tables the screens read (`daily_tenant_stats`, `daily_product_stats`, `conversion_daily`,
 * `device_breakdown_daily`). The collector queues it (`ingest.ts`); the job runs here.
 *
 * **Idempotent by construction**: every figure is *set* to what the day's events say, never added
 * to — running it twice, or two runs at once, writes the same numbers (P2.2's meter relies on
 * this). All of it happens inside the store's own row-level-security transaction.
 *
 * What each figure means (the read side's contract, docs/PACKAGES.md P4):
 *  - **views**: `product_view` events. **add to cart**, **purchases**: their events.
 *  - **AR sessions / try-on sessions**: one visit opening the viewer (`ar_open`) or the try-on
 *    (`tryon_start`) on one product — however many times it taps — counted once that day. This is
 *    the number the plan's "AR sessions per month" limit meters.
 *  - **revenue**: the order values reported with purchases, in riyals (a purchase reported in
 *    another currency is counted as a purchase and adds no riyals — never converted by a guess).
 *  - **store totals and product rows need not agree**: an event whose product reference is not one
 *    of the store's is in the store's totals and in no product's row.
 *  - **conversion** (`conversion_daily`), per product: the visits that saw the product's page, split
 *    by whether the visit opened AR or the try-on on it; a visit *bought* when it reported a purchase
 *    of that product, or a purchase with no product (a whole order). Counts only — the reader decides
 *    whether there is enough to state an uplift.
 *  - **devices**: visits by device family, and how many of them were on a device that supports AR.
 *
 * Raw events expire after 90 days (the retention sweep, A14); roll-ups stay. So a day whose events
 * may already be gone is never recomputed — that would write zeros over real history.
 */
import { sql } from 'drizzle-orm';
import type { Job } from '@/db/schema';
import { riyadhDay } from '@/lib/format';
import { withTenantSql } from '@/server/core/tenancy/rls';

const DAY = 86_400_000;
/** Raw events live 90 days; a day older than this is not recomputed (a margin inside the retention). */
export const RECOMPUTE_DAYS = 85;

export type RollupResult = { day: string; events: number } | { day: string; skipped: 'too_old' | 'not_a_day' };

/** Recompute one store's one day. Safe to run again, and alongside itself. */
export async function rollupDay(tenantId: string, day: string, now = new Date()): Promise<RollupResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00+03:00`))) return { day, skipped: 'not_a_day' };
  if (day < riyadhDay(now.getTime() - RECOMPUTE_DAYS * DAY)) return { day, skipped: 'too_old' };
  const from = new Date(`${day}T00:00:00+03:00`);
  const to = new Date(from.getTime() + DAY);
  // This store's events of this day — named in every statement, and enforced by RLS beneath.
  const inDay = sql`tenant_id = ${tenantId}::uuid AND occurred_at >= ${from.toISOString()}::timestamptz AND occurred_at < ${to.toISOString()}::timestamptz`;
  const visit = sql`session_id || ':' || coalesce(product_id::text, '')`;

  return withTenantSql(tenantId, async (tx) => {
    const counted = await tx.execute(sql`
      INSERT INTO daily_tenant_stats (tenant_id, day, views, ar_sessions, tryon_sessions, add_to_cart, purchases, revenue_minor, unique_sessions)
      SELECT ${tenantId}::uuid, ${day}::date,
        count(*) FILTER (WHERE event_type = 'product_view'),
        count(DISTINCT ${visit}) FILTER (WHERE event_type = 'ar_open'),
        count(DISTINCT ${visit}) FILTER (WHERE event_type = 'tryon_start'),
        count(*) FILTER (WHERE event_type = 'add_to_cart'),
        count(*) FILTER (WHERE event_type = 'purchase'),
        coalesce(sum(value_minor) FILTER (WHERE event_type = 'purchase' AND (currency IS NULL OR currency = 'SAR')), 0),
        count(DISTINCT session_id)
      FROM analytics_events WHERE ${inDay}
      HAVING count(*) > 0
      ON CONFLICT (tenant_id, day) DO UPDATE SET
        views = EXCLUDED.views, ar_sessions = EXCLUDED.ar_sessions, tryon_sessions = EXCLUDED.tryon_sessions,
        add_to_cart = EXCLUDED.add_to_cart, purchases = EXCLUDED.purchases, revenue_minor = EXCLUDED.revenue_minor,
        unique_sessions = EXCLUDED.unique_sessions
      RETURNING (SELECT count(*) FROM analytics_events WHERE ${inDay})::int AS events`);
    const events = Number((rowsOf(counted)[0] as { events?: number } | undefined)?.events ?? 0);
    if (events === 0) return { day, events }; // nothing happened that day: nothing is written

    await tx.execute(sql`
      INSERT INTO daily_product_stats (tenant_id, product_id, day, views, ar_sessions, tryon_sessions, add_to_cart, purchases, revenue_minor, avg_ar_duration_ms)
      SELECT ${tenantId}::uuid, product_id, ${day}::date,
        count(*) FILTER (WHERE event_type = 'product_view'),
        count(DISTINCT session_id) FILTER (WHERE event_type = 'ar_open'),
        count(DISTINCT session_id) FILTER (WHERE event_type = 'tryon_start'),
        count(*) FILTER (WHERE event_type = 'add_to_cart'),
        count(*) FILTER (WHERE event_type = 'purchase'),
        coalesce(sum(value_minor) FILTER (WHERE event_type = 'purchase' AND (currency IS NULL OR currency = 'SAR')), 0),
        coalesce(round(avg(duration_ms) FILTER (WHERE event_type IN ('ar_open', 'ar_place', 'ar_close') AND duration_ms IS NOT NULL)), 0)::int
      FROM analytics_events WHERE ${inDay} AND product_id IS NOT NULL
      GROUP BY product_id
      ON CONFLICT (tenant_id, product_id, day) DO UPDATE SET
        views = EXCLUDED.views, ar_sessions = EXCLUDED.ar_sessions, tryon_sessions = EXCLUDED.tryon_sessions,
        add_to_cart = EXCLUDED.add_to_cart, purchases = EXCLUDED.purchases, revenue_minor = EXCLUDED.revenue_minor,
        avg_ar_duration_ms = EXCLUDED.avg_ar_duration_ms`);

    await tx.execute(sql`
      WITH seen AS (
        SELECT session_id, product_id,
          bool_or(event_type IN ('ar_open', 'ar_place', 'tryon_start', 'tryon_capture')) AS with_ar,
          bool_or(event_type = 'purchase') AS bought
        FROM analytics_events WHERE ${inDay} AND product_id IS NOT NULL
        GROUP BY session_id, product_id
        HAVING bool_or(event_type IN ('product_view', 'ar_open', 'ar_place', 'tryon_start', 'tryon_capture'))
      ), orders AS (
        SELECT DISTINCT session_id FROM analytics_events WHERE ${inDay} AND event_type = 'purchase' AND product_id IS NULL
      )
      INSERT INTO conversion_daily (tenant_id, product_id, day, sessions_with_ar, purchases_with_ar, sessions_without_ar, purchases_without_ar)
      SELECT ${tenantId}::uuid, seen.product_id, ${day}::date,
        count(*) FILTER (WHERE seen.with_ar),
        count(*) FILTER (WHERE seen.with_ar AND (seen.bought OR orders.session_id IS NOT NULL)),
        count(*) FILTER (WHERE NOT seen.with_ar),
        count(*) FILTER (WHERE NOT seen.with_ar AND (seen.bought OR orders.session_id IS NOT NULL))
      FROM seen LEFT JOIN orders ON orders.session_id = seen.session_id
      GROUP BY seen.product_id
      ON CONFLICT (tenant_id, product_id, day) DO UPDATE SET
        sessions_with_ar = EXCLUDED.sessions_with_ar, purchases_with_ar = EXCLUDED.purchases_with_ar,
        sessions_without_ar = EXCLUDED.sessions_without_ar, purchases_without_ar = EXCLUDED.purchases_without_ar`);

    await tx.execute(sql`
      INSERT INTO device_breakdown_daily (tenant_id, day, device_type, sessions, ar_supported)
      SELECT ${tenantId}::uuid, ${day}::date, device_type,
        count(DISTINCT session_id),
        count(DISTINCT session_id) FILTER (WHERE ar_supported = 1)
      FROM analytics_events WHERE ${inDay}
      GROUP BY device_type
      ON CONFLICT (tenant_id, day, device_type) DO UPDATE SET sessions = EXCLUDED.sessions, ar_supported = EXCLUDED.ar_supported`);

    return { day, events };
  });
}

/** node-postgres answers `{ rows }`; PGlite's driver the same — but never assume which. */
function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** The `analytics.rollup` job: `{ day }` for the job's store. */
export async function handleRollupJob(job: Job): Promise<void> {
  if (!job.tenantId) throw new Error(`rollup job ${job.id} has no tenant`);
  const day = (job.payload as { day?: unknown } | null)?.day;
  if (typeof day !== 'string') throw new Error(`rollup job ${job.id} names no day`);
  await rollupDay(job.tenantId, day);
}
