/**
 * P1.17 — the install checker's two pure halves: is this URL safe for our server to fetch,
 * and does this HTML have the widget installed correctly.
 *
 * Fetching a URL a user typed is how servers get turned against their own network (SSRF).
 * So: https only, the default port, no credentials in the URL, no IP literals, no localhost
 * or internal names — and, once the store is connected, only the store's own domain.
 */
import { ATTR, WIDGET_SRC } from '@/widget/src/main';
import { PRODUCT_PLACEHOLDER } from '@/widget/src/snippet';

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function safeTarget(input: string, storeHost: string | null): UrlCheck {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return { ok: false, reason: 'not a web address' }; }
  if (url.protocol !== 'https:') return { ok: false, reason: 'must start with https://' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'must use the normal https port' };
  if (url.username || url.password) return { ok: false, reason: 'must not contain a username or password' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')) return { ok: false, reason: 'must be a domain name, not an IP address' };
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host)) return { ok: false, reason: 'must be a public domain' };
  if (storeHost) {
    const own = storeHost.toLowerCase().replace(/^www\./, '');
    if (host !== own && !host.endsWith(`.${own}`)) return { ok: false, reason: `must be a page of your store (${own})` };
  }
  return { ok: true, url };
}

export type InstallStatus =
  | { status: 'installed'; productRef: string }
  | { status: 'missing_script' | 'wrong_store' | 'missing_placeholder' | 'template_not_rendered' | 'unreachable'; detail: string | null };

/** What the page's HTML says about the install, for store `storeKey`. */
export function inspectHtml(html: string, storeKey: string): InstallStatus {
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  const widget = scripts.find((tag) => tag.includes(WIDGET_SRC) || /\/w\/v\d+\/widget\.js/.test(tag));
  if (!widget) return { status: 'missing_script', detail: null };
  const key = new RegExp(`${ATTR.store}\\s*=\\s*["']?([^"'\\s>]+)`, 'i').exec(widget)?.[1] ?? null;
  if (key !== storeKey) return { status: 'wrong_store', detail: key };
  const product = new RegExp(`${ATTR.product}\\s*=\\s*["']([^"']*)["']`, 'i').exec(html)?.[1] ?? null;
  if (product === null) return { status: 'missing_placeholder', detail: null };
  if (!product.trim() || product.includes('{{') || product === PRODUCT_PLACEHOLDER) return { status: 'template_not_rendered', detail: product };
  return { status: 'installed', productRef: product };
}

/**
 * T95 — the Google Tag Manager containers a page loads (`GTM-K4ZVD3HX`), at most four. A Salla page
 * loads Salla's own container next to the store's; both are read, since the page cannot say which is which.
 */
export function tagManagerIds(html: string): string[] {
  return [...new Set([...html.matchAll(/\bGTM-[A-Z0-9]{4,12}\b/g)].map((m) => m[0]))].slice(0, 4);
}

export type ContainerVerdict =
  | { status: 'ok' | 'missing' | 'not_auto' }
  | { status: 'wrong_store'; key: string | null };

/**
 * T95 — what a published container (`gtm.js`) says about our tag. A Custom HTML tag is in it as a
 * JavaScript string (`<script src=\"https:\/\/…`), so the escapes are undone first and the tag
 * is then read like a page's: our script, this store's key, and the self-placing switch the
 * page-wide tag needs (`data-tajribah-auto`). Only what the owner pressed "Publish" on is in it.
 */
export function inspectContainer(js: string, storeKey: string): ContainerVerdict {
  const text = js
    .replace(/\\u003c|\\x3c/gi, '<').replace(/\\u003e|\\x3e/gi, '>').replace(/\\u0022|\\x22/gi, '"')
    .replace(/\\u0027|\\x27/gi, "'").replace(/\\u0026|\\x26/gi, '&').replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/').replace(/\\"/g, '"');
  const ours = [...text.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => tag.includes(WIDGET_SRC) || /\/w\/v\d+\/widget\.js/.test(tag));
  if (!ours.length) return { status: 'missing' };
  const keyOf = (tag: string) => new RegExp(`${ATTR.store}\\s*=\\s*["']?([^"'\\s>]+)`, 'i').exec(tag)?.[1] ?? null;
  const mine = ours.find((tag) => keyOf(tag) === storeKey);
  if (!mine) return { status: 'wrong_store', key: keyOf(ours[0]!) };
  return new RegExp(`${ATTR.auto}\\s*=\\s*["']?salla\\b`, 'i').test(mine) ? { status: 'ok' } : { status: 'not_auto' };
}

/**
 * P7.7 — DNS rebinding: a public-looking name can resolve to a private or reserved address, which
 * `safeTarget` cannot see. The service resolves each hop's host first and refuses these ranges.
 * (Rebinding *between* that lookup and the fetch remains; a Worker cannot reach private networks
 * anyway, so this closes the remaining practical case: a name that simply points inward.)
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 // this network, private, loopback, multicast + reserved
      || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
      || (a === 169 && b === 254) // link-local (cloud metadata lives here)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && Number(v4[3]) === 0)
      || (a === 198 && (b === 18 || b === 19)); // benchmarking
  }
  const v6 = ip.toLowerCase();
  if (!v6.includes(':')) return true; // not an address at all: refuse
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}
