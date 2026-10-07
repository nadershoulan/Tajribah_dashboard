/**
 * T62 — a store's own address (like `ar.theirstore.com`), served by this site through Cloudflare for
 * SaaS. On such an address only the store's try-on lives: the frame the shop opens, the phone page a QR
 * code opens, the pairing API behind them, the store's products' own pages (P1.19), and the files they load. Anything else — the marketing
 * pages, the privacy page a link in the frame points to — belongs to Tajribah's own site, so the
 * browser is sent there instead of seeing Tajribah's site under a store's name.
 *
 * The site's own hosts come from `SITE_HOSTS` (comma-separated; the first is where other paths are sent).
 * Unset — on this machine, in a preview — nothing is restricted: every host is the site's.
 */
import { isLocalHost } from './tryon-config';

const STORE_PATHS = [
  /^\/embed\/try-on\/?$/,
  /^\/p\/[^/]+\/[^/]+\/?$/,
  /^\/capture\/[a-f0-9]{32}\/?$/,
  /^\/api\/pair(?:\/[a-f0-9]{32})?\/?$/,
  /^\/(?:_next|assets|brand|wasm)\//,
  /^\/favicon\.ico$/,
  // T113: the visit collector. The widget posts to ev.tajribah.org/v1/e, a host that is not one of the site's
  // own; redirected, a POST becomes a GET and every event is lost (found at launch, 2026-10-08).
  /^\/v1\/e\/?$/,
];

export function siteHosts(value: string | undefined | null): string[] {
  return (value ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** Does a store's own address serve this path? */
export const isStorePath = (pathname: string) => STORE_PATHS.some((p) => p.test(pathname));

/** The store's own address this request reached, or null: Tajribah's own hosts, this machine, or no hosts named. */
export function storeHostOf(url: URL, hosts: string[]): string | null {
  const host = url.hostname.toLowerCase();
  return !hosts.length || hosts.includes(host) || isLocalHost(host) ? null : host;
}

/** Where to send a request that reached a store's address for something that is not the store's; null to serve it. */
export function storeHostRedirect(url: URL, hosts: string[]): string | null {
  if (!storeHostOf(url, hosts) || isStorePath(url.pathname)) return null;
  return `https://${hosts[0]}${url.pathname}${url.search}`;
}

/**
 * The mark the worker puts on a request that reached a store's address, so the pages there show only
 * that store's products: without it, `/p/{another store}/…` or `/embed/try-on?store={another store}`
 * would show another store's product under this store's name. Never taken from outside — the worker
 * removes any copy a request arrives with.
 */
export const STORE_HOST_HEADER = 'x-tajribah-store-host';

/** The request the site handles: marked with the store's address it reached; any outside copy of the mark gone. */
export function markStoreHost(request: Request, hosts: string[]): Request {
  const host = storeHostOf(new URL(request.url), hosts);
  if (!host && !request.headers.has(STORE_HOST_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(STORE_HOST_HEADER);
  if (host) headers.set(STORE_HOST_HEADER, host);
  return new Request(request, { headers });
}

/**
 * May a page on this address show a config published for `configHost` (the store's own address in the
 * config, when it has one)? On Tajribah's own address, any; on a store's address, only its own.
 */
export const servesHere = (storeHost: string | null | undefined, configHost: string | null | undefined): boolean =>
  !storeHost || (typeof configHost === 'string' && configHost.toLowerCase() === storeHost);
