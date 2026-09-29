/**
 * P7 — the caching strategy's one server-side cache: short-lived answers for reads that are
 * costly and may be a minute old — the dashboard's charts (plan D5: "cached 60s").
 *
 *  - **Every key starts with the store** (plan §6: `t:{tenantId}:{domain}:{id}` — "a cache key
 *    without a tenant prefix is a cross-tenant leak waiting for a collision"). `cachedFor` takes the
 *    store from the request's own context; a caller cannot name another store, and the store id is
 *    checked to be a uuid, so no `id` can reach into another store's keys.
 *  - **Where:** Cloudflare's Cache API in a Worker (per data centre, no binding, no cost); memory
 *    elsewhere (local, tests) — capped, so it cannot grow without bound.
 *  - **A cache never breaks a read:** a failing get or put is logged and the answer computed.
 *  - Permission checks happen before the cache is asked (`ctx.require` first, in the caller).
 *
 * Not cached: anything a merchant just changed and expects to see (products, settings, team) —
 * those reads are cheap and must be exact. The shopper path never reaches this file (plan D3).
 */
import { log } from '../observability/log';

export interface CacheStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^[a-z][a-z0-9-]{0,39}$/;

/** `t:{tenantId}:{domain}:{id}` — the only shape a cache key may take. */
export function tenantKey(tenantId: string, domain: string, id: string): string {
  if (!UUID.test(tenantId)) throw new Error('cache key: the store id must be a uuid');
  if (!DOMAIN.test(domain)) throw new Error(`cache key: domain "${domain}" must be lowercase words`);
  if (!id || id.length > 200) throw new Error('cache key: id must be 1 to 200 characters');
  return `t:${tenantId.toLowerCase()}:${domain}:${id}`;
}

/** Memory, for local work and tests: expiring entries, the oldest dropped past `max`. */
export class MemoryCache implements CacheStore {
  private entries = new Map<string, { value: string; until: number }>();
  constructor(private readonly max = 500, private readonly clock: () => number = Date.now) {}
  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.until <= this.clock()) { this.entries.delete(key); return null; }
    return entry.value;
  }
  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value, until: this.clock() + ttlSeconds * 1000 });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }
  get size(): number { return this.entries.size; }
}

/** The part of the Workers Cache API used here. */
export type EdgeCacheLike = { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> };

/** Cloudflare's Cache API (`caches.default`): per data centre, expiry by `Cache-Control: max-age`. */
export class EdgeCache implements CacheStore {
  constructor(private readonly cache: EdgeCacheLike) {}
  // A synthetic address: the Cache API keys on URLs. Never fetched; the key is encoded whole.
  private request(key: string) { return new Request(`https://cache.tajribah.internal/${encodeURIComponent(key)}`); }
  async get(key: string): Promise<string | null> {
    const hit = await this.cache.match(this.request(key));
    return hit ? hit.text() : null;
  }
  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.cache.put(this.request(key), new Response(value, {
      headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttlSeconds}` },
    }));
  }
}

let store: CacheStore | null = null;

/** Tests, or a runtime that wants its own. Unset → the Cache API in a Worker, memory otherwise. */
export function configureCache(next: CacheStore | null): void {
  store = next;
}

export function cacheStore(): CacheStore {
  if (!store) {
    const edge = (globalThis as { caches?: { default?: EdgeCacheLike } }).caches?.default;
    store = edge ? new EdgeCache(edge) : new MemoryCache();
  }
  return store;
}

/**
 * The store's cached answer for `domain`/`id`, or `compute()`'s — then kept for `ttlSeconds`.
 * The store comes from `ctx`; put what the answer depends on (range, day, plan level) in `id`.
 */
export async function cachedFor<T>(ctx: { tenantId: string }, domain: string, id: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const key = tenantKey(ctx.tenantId, domain, id);
  const cache = cacheStore();
  try {
    const hit = await cache.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (error) {
    log.warn('cache read failed; computing', { domain, error: error instanceof Error ? error.message : String(error) });
  }
  const value = await compute();
  try {
    await cache.put(key, JSON.stringify(value), ttlSeconds);
  } catch (error) {
    log.warn('cache write failed', { domain, error: error instanceof Error ? error.message : String(error) });
  }
  return value;
}
