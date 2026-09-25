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
