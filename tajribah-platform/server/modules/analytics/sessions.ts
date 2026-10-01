/**
 * P4.10 — the session explorer: the visits of one Riyadh day, and one visit's path through the shop,
 * read from the raw events — so only as far back as those are kept (90 days; the roll-ups stay).
 *
 * A "session" is the collector's daily hashed id (`ingest.ts`): it names no person, cannot be joined
 * to another day or another shop, and is shown here only as the key to ask for one visit's events.
 * What a path shows is what a row holds: the event, its product, the device family, the country —
 * and the properties the merchant's own page sent.
 *
 * Full analytics (T35), for anyone who may read analytics. One store's rows only.
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { analyticsEvents, products } from '@/db/schema';
import { riyadhDay } from '@/lib/format';
import type { SessionListView, SessionPathView } from '@/lib/view-models';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenantSql } from '@/server/core/tenancy/rls';

const DAY = 86_400_000;
/** Raw events are kept this long (the retention rule, `admin/retention.ts`). */
export const KEPT_DAYS = 90;
export const SESSIONS_PAGE = 50;
export const SESSIONS_MAX_OFFSET = 950;
export const PATH_MAX_EVENTS = 500;
export const SESSION_FILTERS = ['all', 'opened', 'bought'] as const;
export type SessionFilter = (typeof SESSION_FILTERS)[number];

const rowsOf = (result: unknown): Record<string, unknown>[] =>
  (Array.isArray(result) ? result : ((result as { rows?: unknown[] } | null)?.rows ?? [])) as Record<string, unknown>[];
const iso = (value: unknown) => new Date(value as string | Date).toISOString();

async function allowed(ctx: TenantContext): Promise<void> {
  ctx.require('analytics:read');
  assertFeature(await entitlementsOf(ctx), 'full_analytics');
}

/** API-124 — the visits of one Riyadh day, latest first. */
export async function sessionList(ctx: TenantContext, input: { day?: string | null; filter?: SessionFilter; offset?: number } = {}, now = new Date()): Promise<SessionListView> {
  await allowed(ctx);
  const today = riyadhDay(now);
  const oldest = riyadhDay(now.getTime() - (KEPT_DAYS - 1) * DAY);
  const day = input.day ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00+03:00`))) throw errors.validation({ day: ['a day, like 2026-10-01'] });
  const filter = input.filter ?? 'all';
  const offset = Math.min(SESSIONS_MAX_OFFSET, Math.max(0, Math.floor(input.offset ?? 0)));
  const base = { day, today, oldest, filter, offset };
  // Outside what is kept (or not yet happened): nothing to read, said plainly rather than as an empty day.
  if (day < oldest || day > today) return { ...base, sessions: [], more: false, kept: false };

  const from = new Date(`${day}T00:00:00+03:00`);
  const to = new Date(from.getTime() + DAY);
  const having = filter === 'opened' ? sql`HAVING bool_or(event_type IN ('ar_open', 'tryon_start'))`
    : filter === 'bought' ? sql`HAVING bool_or(event_type = 'purchase')` : sql``;
  const rows = await withTenantSql(ctx.tenantId, async (tx) => rowsOf(await tx.execute(sql`
    SELECT session_id, min(occurred_at) AS first_at, max(occurred_at) AS last_at, count(*)::int AS events,
      count(DISTINCT product_id)::int AS products,
      bool_or(event_type IN ('ar_open', 'tryon_start')) AS opened,
      bool_or(event_type = 'add_to_cart') AS carted,
      bool_or(event_type = 'purchase') AS bought,
      max(device_type::text) AS device, max(country) AS country
    FROM analytics_events
    WHERE tenant_id = ${ctx.tenantId}::uuid AND occurred_at >= ${from.toISOString()}::timestamptz AND occurred_at < ${to.toISOString()}::timestamptz
    GROUP BY session_id ${having}
    ORDER BY max(occurred_at) DESC, session_id
    LIMIT ${SESSIONS_PAGE + 1} OFFSET ${offset}`)));

  return {
    ...base, kept: true, more: rows.length > SESSIONS_PAGE,
    sessions: rows.slice(0, SESSIONS_PAGE).map((r) => ({
      id: String(r.session_id), firstAt: iso(r.first_at), lastAt: iso(r.last_at), events: Number(r.events), products: Number(r.products),
      opened: r.opened === true, carted: r.carted === true, bought: r.bought === true,
      device: (r.device ?? 'unknown') as SessionListView['sessions'][number]['device'], country: (r.country as string | null) ?? null,
    })),
  };
}

/** API-125 — one visit's events in order. A visit that is not this store's (or has expired) is not found. */
export async function sessionPath(ctx: TenantContext, sessionId: string): Promise<SessionPathView> {
  await allowed(ctx);
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(sessionId)) throw errors.notFound('visit');
  const rows = await ctx.db.find(analyticsEvents, eq(analyticsEvents.sessionId, sessionId),
    { limit: PATH_MAX_EVENTS + 1, orderBy: [asc(analyticsEvents.occurredAt), asc(analyticsEvents.id)] });
  if (rows.length === 0) throw errors.notFound('visit');
  const shown = rows.slice(0, PATH_MAX_EVENTS);
  const ids = [...new Set(shown.map((e) => e.productId).filter((id): id is string => !!id))];
  const names = ids.length ? new Map((await ctx.db.find(products, inArray(products.id, ids), { limit: ids.length })).map((p) => [p.id, p.name])) : new Map<string, string>();
  const first = shown[0]!;
  return {
    id: sessionId, firstAt: first.occurredAt.toISOString(), lastAt: shown.at(-1)!.occurredAt.toISOString(),
    device: first.deviceType, os: first.os, browser: first.browser, country: first.country, region: first.region, page: first.referrerHost,
    truncated: rows.length > PATH_MAX_EVENTS,
    events: shown.map((e) => ({
      at: e.occurredAt.toISOString(), type: e.eventType,
      productId: e.productId, product: e.productId ? names.get(e.productId) ?? null : null,
      durationMs: e.durationMs, valueMinor: e.valueMinor, currency: e.currency, properties: e.properties ?? {},
    })),
  };
}
