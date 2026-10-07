/**
 * P4.2 — the event collector: `POST /api/analytics/collect` (served at `ev.tajribah.org/v1/e`).
 *
 * A public endpoint by nature: the batch comes from a browser in someone else's shop, with a
 * store key anyone can read in the page. Nothing here authenticates — it is defended instead,
 * in this order (docs/PACKAGES.md, P4.2):
 *
 *  1. **The body is capped before it is read**: by `Content-Length`, then while streaming. The SDK
 *     refuses a batch over `LIMITS.bodyBytes` *characters* (it measures the string), and a
 *     character is at most three bytes — so the stream stops at three times that, and the decoded
 *     text is then held to the SDK's own figure.
 *  2. **The store key is resolved first**; an unknown one is dropped with one indexed lookup,
 *     remembered for a minute, and no error that says anything about the body.
 *  3. **Rate limits**: per store and visitor (the address hashed with the day, never stored)
 *     through the shared `rateLimiter()`; and per store, counted in this isolate — a shared
 *     counter written twenty times a second is exactly what Workers KV refuses (one write per
 *     second per key). Over either: 204, dropped, counted — never a 429, the SDK never retries.
 *  4. **Origin is a soft signal**: the page's host is stored (`referrer_host`) and never judged —
 *     a missing Origin is normal, and a store's connected address is often not its public one.
 *  5. **Every field is distrusted**: the contract (`lib/contracts/analytics.ts`) validates the
 *     batch whole; the row's time is this server's clock; the product is this store's own row or
 *     nothing; device, system, browser family and country are derived from the request and the
 *     request's address and user agent are then dropped — neither is ever a column.
 *
 * The session token is hashed with the store and the Riyadh day before it is stored, so the same
 * tab on two days — or in two shops — is two unrelated ids (§7.10).
 *
 * After the rows are written, a roll-up of each touched day is queued (`rollup.ts`): one job per
 * store per day per `ROLLUP_EVERY_MS`, due at the end of that window, so every event written
 * before the job runs is in it.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { analyticsEvents, products, tenants } from '@/db/schema';
import { LIMITS as EVENT_LIMITS, parseBatch, toRow, type EventRow } from '@/lib/contracts/analytics';
import { riyadhDay } from '@/lib/format';
import { keyedHash } from '@/server/core/auth/crypto';
import { enqueue } from '@/server/core/jobs/queue';
import { log } from '@/server/core/observability/log';
import { MemoryRateLimiter, rateLimiter } from '@/server/core/ratelimit/limiter';
import { withTenant } from '@/server/core/tenancy/rls';

/** While streaming: three bytes per character of the SDK's own cap. */
export const MAX_BATCH_BYTES = EVENT_LIMITS.bodyBytes * 3;
/** Starting numbers, to be tuned by the load tests (docs/PACKAGES.md, P4.2's table). */
export const COLLECT_LIMITS = {
  /** ~12 active tabs behind one address, per store — never per address alone (carrier NAT). */
  visitor: { limit: 60, windowSeconds: 60 },
  /** Far above any plan's real traffic: trips on a flood, never on a sale day. */
  store: { limit: 1200, windowSeconds: 60 },
} as const;
type Limits = Record<keyof typeof COLLECT_LIMITS, { limit: number; windowSeconds: number }>;
/** A store's day is rolled up at most once per this long. */
export const ROLLUP_EVERY_MS = 5 * 60_000;
const CACHE_MS = 60_000;
const CACHE_MAX = 20_000;

export type CollectOutcome =
  | 'accepted' | 'too_large' | 'not_json' | 'invalid' | 'unknown_store' | 'store_off'
  | 'robot' | 'limited_visitor' | 'limited_store';

const counts: Record<CollectOutcome, number> = {
  accepted: 0, too_large: 0, not_json: 0, invalid: 0, unknown_store: 0, store_off: 0, robot: 0, limited_visitor: 0, limited_store: 0,
};
/** What this isolate has done with the batches it saw, by outcome. */
export const collectorCounts = (): Readonly<Record<CollectOutcome, number>> => ({ ...counts });

// ------------------------------------------------------------------- what is remembered

type Remembered<T> = Map<string, { at: number; value: T }>;
function remember<T>(cache: Remembered<T>, key: string, value: T, now: number): T {
  if (cache.size >= CACHE_MAX) cache.clear(); // bounded: a flood of made-up keys cannot grow it
  cache.set(key, { at: now, value });
  return value;
}
const recall = <T>(cache: Remembered<T>, key: string, now: number) => {
  const hit = cache.get(key);
  return hit && now - hit.at < CACHE_MS ? hit : undefined;
};

type Store = { id: string; open: boolean };
const stores: Remembered<Store | null> = new Map();
const productIds: Remembered<string | null> = new Map();
const queued = new Set<string>();
let floods = new MemoryRateLimiter();
const warned = new Map<string, number>();

/** Forget everything remembered in this isolate (tests). */
export function resetCollector(): void {
  stores.clear(); productIds.clear(); queued.clear(); warned.clear();
  floods = new MemoryRateLimiter();
  for (const key of Object.keys(counts) as CollectOutcome[]) counts[key] = 0;
}

/** A store's public key is its address name (`lib/slug.ts`); anything else is not looked up. */
const KEY = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const SERVING = new Set(['trial', 'active', 'past_due']);

async function storeOf(key: string, now: number): Promise<Store | null> {
  if (!KEY.test(key)) return null;
  const hit = recall(stores, key, now);
  if (hit) return hit.value;
  // The key is looked up before any store's scope exists — the platform lookup a webhook makes.
  const [row] = await unsafeAdminDb().select({ id: tenants.id, status: tenants.status, deletedAt: tenants.deletedAt })
    .from(tenants).where(eq(tenants.slug, key)).limit(1);
  return remember(stores, key, row && !row.deletedAt ? { id: row.id, open: SERVING.has(row.status) } : null, now);
}

// ------------------------------------------------------------------------ the request

/** The body as text, or null when it is larger than the cap — decided without reading past it. */
export async function readCapped(request: Request, cap = MAX_BATCH_BYTES): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > cap) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

const ROBOT = /bot\b|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|curl\/|wget\/|python-|node-fetch|axios/i;

/** Device, system and browser *family* — never the user agent itself, and no versions. */
export function deviceOf(userAgent: string | null): { robot: boolean; deviceType: NonNullable<EventRow['deviceType']>; os: string | null; browser: string | null } {
  const ua = userAgent ?? '';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux|X11/.test(ua) ? 'Linux' : null;
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /SamsungBrowser\//.test(ua) ? 'Samsung Internet' : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const deviceType = /iPad|Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet'
    : /Mobi|iPhone|iPod|Windows Phone/.test(ua) ? 'mobile'
    : os ? 'desktop' : 'unknown';
  return { robot: ROBOT.test(ua), deviceType, os, browser };
}

const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
/** The host of the page that sent the batch — from Origin, else Referer; nothing else of either. */
export function pageHost(headers: Headers): string | null {
  for (const name of ['origin', 'referer']) {
    try {
      const host = new URL(headers.get(name) ?? '').hostname.toLowerCase();
      if (HOST.test(host)) return host;
    } catch { /* absent or not a URL: the next one */ }
  }
  return null;
}

const upper = (value: string | null, shape: RegExp) => (value && shape.test(value.toUpperCase()) ? value.toUpperCase() : null);
/** Country and region as the edge says them (Cloudflare's headers); `XX` and `T1` are not countries. */
export function placeOf(headers: Headers): { country: string | null; region: string | null } {
  const country = upper(headers.get('cf-ipcountry'), /^[A-Z]{2}$/);
  return { country: country === 'XX' || country === 'T1' ? null : country, region: upper(headers.get('cf-region-code'), /^[A-Z0-9]{1,3}$/) };
}

// ---------------------------------------------------------------------- this store's rows

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The merchant's own product references → this store's product ids (`externalId ?? id`, as published). */
async function resolveProducts(tenantId: string, refs: string[], now: number): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  const unknown: string[] = [];
  for (const ref of refs) {
    const hit = recall(productIds, `${tenantId}:${ref}`, now);
    if (hit) found.set(ref, hit.value); else unknown.push(ref);
  }
  if (unknown.length) {
    const uuids = unknown.filter((ref) => UUID.test(ref));
    const rows = await withTenant(tenantId, (tx) => tx.find(products,
      uuids.length ? or(inArray(products.externalId, unknown), and(isNull(products.externalId), inArray(products.id, uuids))) : inArray(products.externalId, unknown),
      { limit: 2 * unknown.length }));
    for (const ref of unknown) {
      const row = rows.find((p) => p.externalId === ref) ?? rows.find((p) => p.externalId === null && p.id === ref.toLowerCase());
      found.set(ref, remember(productIds, `${tenantId}:${ref}`, row?.id ?? null, now));
    }
  }
  return found;
}

async function queueRollups(tenantId: string, days: Set<string>, now: number): Promise<void> {
  const window = Math.floor(now / ROLLUP_EVERY_MS) + 1;
  for (const day of days) {
    const key = `analytics.rollup:${tenantId}:${day}:${window}`;
    if (queued.has(key)) continue; // this isolate already asked for this window's job
    await enqueue({ queue: 'analytics.rollup', tenantId, payload: { day }, priority: 200, runAfter: new Date(window * ROLLUP_EVERY_MS), dedupeKey: key });
    if (queued.size >= CACHE_MAX) queued.clear();
    queued.add(key);
  }
}

// --------------------------------------------------------------------------- the collector

/**
 * Take one batch. Returns what was done with it; only `accepted` wrote anything.
 * `secret` salts the session and the visitor hash (the app's `AUTH_SECRET`).
 */
export async function collect(request: Request, deps: { secret: string; now?: Date; limits?: Limits }): Promise<CollectOutcome> {
  const outcome = await take(request, deps.secret, deps.now ?? new Date(), deps.limits ?? COLLECT_LIMITS);
  counts[outcome] += 1;
  return outcome;
}

async function take(request: Request, secret: string, receivedAt: Date, limits: Limits): Promise<CollectOutcome> {
  const now = receivedAt.getTime();
  const text = await readCapped(request);
  if (text === null || text.length > EVENT_LIMITS.bodyBytes) return 'too_large';

  let body: unknown;
  try { body = JSON.parse(text); } catch { return 'not_json'; }
  const key = (body as { store?: unknown } | null)?.store;
  if (typeof key !== 'string') return 'invalid';

  const store = await storeOf(key, now);
  if (!store) return 'unknown_store';
  if (!store.open) return 'store_off';

  const device = deviceOf(request.headers.get('user-agent'));
  if (device.robot) return 'robot';

  // The visitor: the address hashed with the day — a key for this minute's counter, never a column.
  const day = riyadhDay(receivedAt);
  const address = request.headers.get('cf-connecting-ip') ?? 'none';
  const visitor = (await keyedHash(secret, 'collect-visitor', `${day}:${address}`)).slice(0, 22);
  try {
    const hit = await rateLimiter().hit(`collect:${store.id}:${visitor}`, limits.visitor.limit, limits.visitor.windowSeconds);
    if (!hit.allowed) return 'limited_visitor';
  } catch (error) {
    // The shared limiter being down must not lose a shop's events: let the batch through.
    log.warn('collector: the rate limiter failed, batch let through', { error: error instanceof Error ? error.message : String(error) });
  }
  if (!(await floods.hit(store.id, limits.store.limit, limits.store.windowSeconds)).allowed) {
    const minute = Math.floor(now / 60_000);
    if (warned.get(store.id) !== minute) { // once a minute per store: staff should see it, the log should not drown
      if (warned.size >= CACHE_MAX) warned.clear();
      warned.set(store.id, minute);
      log.warn('collector: a store is over its event limit, batches dropped', { tenantId: store.id, limit: limits.store.limit });
    }
    return 'limited_store';
  }

  const parsed = parseBatch(body);
  if (!parsed.ok) return 'invalid';
  const batch = parsed.batch;

  const refs = [...new Set(batch.events.map((e) => e.productId).filter((ref): ref is string => !!ref))];
  const resolved = await resolveProducts(store.id, refs, now);
  const sessionId = await keyedHash(secret, 'analytics-session', `${store.id}:${day}:${batch.session}`);
  const place = placeOf(request.headers);
  const referrerHost = pageHost(request.headers);
  const rows = batch.events.map((event) => toRow(event, batch, {
    tenantId: store.id, sessionId, receivedAt,
    // A reference this store does not have is counted for the store and for no product.
    productId: event.productId ? resolved.get(event.productId) ?? null : null,
    deviceType: device.deviceType, os: device.os, browser: device.browser, ...place, referrerHost,
  }));

  await withTenant(store.id, (tx) => tx.insert(analyticsEvents, rows));
  await queueRollups(store.id, new Set(rows.map((row) => riyadhDay(row.occurredAt as Date))), now);
  return 'accepted';
}

/** The answer the browser gets: nothing to read in any case, and no hint of which limit was met. */
export function collectResponse(outcome: CollectOutcome): Response {
  const status = outcome === 'too_large' ? 413 : outcome === 'not_json' || outcome === 'invalid' ? 400 : 204;
  return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}
