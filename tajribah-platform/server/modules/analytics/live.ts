/**
 * P4.9 — what is happening in the shop now: read from the **raw events**, not the roll-ups (which
 * are minutes behind by design). The last half hour, minute by minute; the visits active in the
 * last five minutes; and the latest events with the product each was about.
 *
 * One store's rows only (its own transaction, row-level security beneath), and nothing that is not
 * already in a row: an event's kind, product, device family and country. No visitor is shown — a
 * visit here is a count.
 *
 * Kept for ten seconds per store: the screen asks every half minute, several people may have it
 * open, and "now" does not need to be newer than that.
 */
import { and, desc, gt, inArray, lte, sql } from 'drizzle-orm';
import { analyticsEvents, products } from '@/db/schema';
import type { LiveActivityView } from '@/lib/view-models';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { cachedFor } from '@/server/core/cache/cache';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenantSql } from '@/server/core/tenancy/rls';

export const LIVE_MINUTES = 30;
export const ACTIVE_MINUTES = 5;
export const LIVE_LATEST = 12;
export const LIVE_CACHE_SECONDS = 10;
const MINUTE = 60_000;

const rowsOf = (result: unknown): Record<string, unknown>[] =>
  (Array.isArray(result) ? result : ((result as { rows?: unknown[] } | null)?.rows ?? [])) as Record<string, unknown>[];

/** API-123 — the live view (full analytics, like the other reports — T35). */
export async function liveActivity(ctx: TenantContext, now = new Date()): Promise<LiveActivityView> {
  ctx.require('analytics:read');
  assertFeature(await entitlementsOf(ctx), 'full_analytics');
  return cachedFor(ctx, 'analytics', 'live', LIVE_CACHE_SECONDS, () => compute(ctx, now));
}

async function compute(ctx: TenantContext, now: Date): Promise<LiveActivityView> {
  const thisMinute = Math.floor(now.getTime() / MINUTE) * MINUTE;
  const since = new Date(thisMinute - (LIVE_MINUTES - 1) * MINUTE);
  const activeSince = new Date(now.getTime() - ACTIVE_MINUTES * MINUTE);
  const window = sql`tenant_id = ${ctx.tenantId}::uuid AND occurred_at <= ${now.toISOString()}::timestamptz`;

  const [perMinute, active] = await withTenantSql(ctx.tenantId, async (tx) => [
    rowsOf(await tx.execute(sql`
      SELECT floor(extract(epoch FROM occurred_at) / 60)::bigint AS minute,
        count(*) FILTER (WHERE event_type = 'product_view')::int AS views,
        count(*) FILTER (WHERE event_type IN ('ar_open', 'tryon_start'))::int AS opens
      FROM analytics_events WHERE ${window} AND occurred_at >= ${since.toISOString()}::timestamptz
      GROUP BY 1`)),
    rowsOf(await tx.execute(sql`
      SELECT count(DISTINCT session_id)::int AS visits
      FROM analytics_events WHERE ${window} AND occurred_at > ${activeSince.toISOString()}::timestamptz`)),
  ]);

  const byMinute = new Map(perMinute.map((r) => [Number(r.minute) * MINUTE, r]));
  const minutes = Array.from({ length: LIVE_MINUTES }, (_, i) => {
    const at = since.getTime() + i * MINUTE;
    const r = byMinute.get(at);
    return { at: new Date(at).toISOString(), views: Number(r?.views ?? 0), opens: Number(r?.opens ?? 0) };
  });

  const latest = await ctx.db.find(analyticsEvents, and(gt(analyticsEvents.occurredAt, new Date(since.getTime() - 1)), lte(analyticsEvents.occurredAt, now)),
    { limit: LIVE_LATEST, orderBy: [desc(analyticsEvents.occurredAt), desc(analyticsEvents.id)] });
  const ids = [...new Set(latest.map((e) => e.productId).filter((id): id is string => !!id))];
  const names = ids.length ? new Map((await ctx.db.find(products, inArray(products.id, ids), { limit: ids.length })).map((p) => [p.id, p.name])) : new Map<string, string>();

  return {
    asOf: now.toISOString(),
    activeVisits: Number(active[0]?.visits ?? 0),
    minutes,
    latest: latest.map((e) => ({
      at: e.occurredAt.toISOString(), type: e.eventType, product: e.productId ? names.get(e.productId) ?? null : null,
      device: e.deviceType, country: e.country,
    })),
  };
}
