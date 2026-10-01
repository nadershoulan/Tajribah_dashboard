/**
 * T62 — a store's own address (like `ar.theirstore.com`), served by this site through Cloudflare for
 * SaaS. On such an address only the store's try-on lives: the frame the shop opens, the phone page a QR
 * code opens, the pairing API behind them, and the files they load. Anything else — the marketing
 * pages, the privacy page a link in the frame points to — belongs to Tajribah's own site, so the
 * browser is sent there instead of seeing Tajribah's site under a store's name.
 *
 * The site's own hosts come from `SITE_HOSTS` (comma-separated; the first is where other paths are sent).
 * Unset — on this machine, in a preview — nothing is restricted: every host is the site's.
 */
import { isLocalHost } from './tryon-config';

const STORE_PATHS = [
  /^\/embed\/try-on\/?$/,
  /^\/capture\/[a-f0-9]{32}\/?$/,
  /^\/api\/pair(?:\/[a-f0-9]{32})?\/?$/,
  /^\/(?:_next|assets|brand|wasm)\//,
  /^\/favicon\.ico$/,
];

export function siteHosts(value: string | undefined | null): string[] {
  return (value ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** Does a store's own address serve this path? */
export const isStorePath = (pathname: string) => STORE_PATHS.some((p) => p.test(pathname));

/** Where to send a request that reached a store's address for something that is not the store's; null to serve it. */
export function storeHostRedirect(url: URL, hosts: string[]): string | null {
  const host = url.hostname.toLowerCase();
  if (!hosts.length || hosts.includes(host) || isLocalHost(host) || isStorePath(url.pathname)) return null;
  return `https://${hosts[0]}${url.pathname}${url.search}`;
}
