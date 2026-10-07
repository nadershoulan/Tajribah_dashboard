/**
 * P1.15 — the config host (`cfg.tajribah.org`): answers the widget's and the try-on page's
 * `GET /v1/{store key}/{product ref}.json` from the config store, never from Postgres.
 *
 *  - Public and read-only: any shop page may read (CORS `*`, no credentials); nothing else is served.
 *  - Short caching, both for a config and for "none": a publish or a withdrawal reaches shoppers
 *    within a minute, and a shop full of products without configs does not reach KV on every view.
 *  - Segments are decoded and re-encoded through `configKey`, so a request can only name a key
 *    the publisher could have written.
 *
 * `config-worker.ts` is the Worker that runs it, bound to the same KV namespace the dashboard writes.
 */
import { configKey, configStore, type ConfigStore } from './configs';

const CACHE = 'public, max-age=60';
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': CACHE,
};

export async function serveConfig(request: Request, store: ConfigStore = configStore()): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...HEADERS, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Max-Age': '86400' } });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { ...HEADERS, Allow: 'GET, HEAD, OPTIONS' } });
  const key = keyOf(new URL(request.url).pathname);
  const body = key ? await store.get(key) : null;
  if (body === null) return new Response(null, { status: 404, headers: HEADERS });
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** `/v1/{store}/{ref}.json` → the config key, or null for anything else. */
export function keyOf(pathname: string): string | null {
  const match = /^\/v1\/([^/]+)\/([^/]+)\.json$/.exec(pathname);
  if (!match) return null;
  try {
    return configKey(decodeURIComponent(match[1]!), decodeURIComponent(match[2]!));
  } catch {
    return null;
  }
}
