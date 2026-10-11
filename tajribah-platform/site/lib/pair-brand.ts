/**
 * T61 — white-label on the phone page. A QR code started in the try-on frame of an Enterprise
 * store opens a phone page with that store's name and logo, not Tajribah's.
 *
 * The studio starts a pairing with a plain `POST /api/pair` (its code is unchanged), so the store is
 * read from where that request came from: the frame's own address, `/embed/try-on?store=…&product=…`,
 * which the browser sends as the Referer of a same-origin request. The brand itself is then read
 * from Tajribah's config host for that store and product — never from the request — so a forged
 * Referer can only ever show a real store's own published name and logo. Anything else (the demo
 * page, another site, no Referer, no brand, the host unreachable) → no brand: Tajribah's, as before.
 */
import { brandFrom, configBase, configUrl, isLocalHost, validRefs, type StoreBrand } from './tryon-config';
import { demoPairing, pairingFromConfig, pairRequestOf, type Pairing } from './pair-product';

/** The frame's store and product, when the request came from the try-on frame on this site. */
export function embedRefsOf(request: Request): { store: string; product: string; base: string | null } | null {
  const referer = request.headers.get('referer');
  if (!referer) return null;
  let from: URL;
  try { from = new URL(referer); } catch { return null; }
  if (from.origin !== new URL(request.url).origin || from.pathname.replace(/\/+$/, '') !== '/embed/try-on') return null;
  const store = from.searchParams.get('store') ?? '';
  const product = from.searchParams.get('product') ?? '';
  return validRefs(store, product) ? { store, product, base: from.searchParams.get('base') } : null;
}

export async function brandOfPairing(request: Request, fetcher: typeof fetch = fetch): Promise<StoreBrand | null> {
  const refs = embedRefsOf(request);
  if (!refs) return null;
  const local = isLocalHost(new URL(request.url).hostname);
  try {
    const response = await fetcher(configUrl(configBase(refs.base, local), refs.store, refs.product), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(2000) });
    return response.ok ? brandFrom(await response.json(), local) : null;
  } catch {
    return null;
  }
}

/**
 * T134.3 — the store and product a pairing came from: the try-on frame (above), or the product's own page on this
 * site (`/p/{store}/{product}`, which shows the same studio).
 */
export function refsOf(request: Request): { store: string; product: string; base: string | null } | null {
  const framed = embedRefsOf(request);
  if (framed) return framed;
  const referer = request.headers.get('referer');
  if (!referer) return null;
  let from: URL;
  try { from = new URL(referer); } catch { return null; }
  if (from.origin !== new URL(request.url).origin) return null;
  const m = /^\/p\/([^/]+)\/([^/]+)\/?$/.exec(from.pathname);
  if (!m) return null;
  let store: string, product: string;
  try { store = decodeURIComponent(m[1]!); product = decodeURIComponent(m[2]!); } catch { return null; }
  return validRefs(store, product) ? { store, product, base: null } : null;
}

/**
 * T134.3 — everything the phone page needs, read on the server: from the config host for a store's product (brand,
 * store name, product), from the site's own list for a demo product (by SKU). The studio's own word counts only for
 * the kind of guide to show. The host unreachable or nothing found: no product — the phone still takes the photo and
 * sends it to the screen, as before.
 */
export async function pairingOf(request: Request, body: string, fetcher: typeof fetch = fetch): Promise<Pairing> {
  const asked = pairRequestOf(body);
  const here = new URL(request.url);
  const refs = refsOf(request);
  // T137: where others can try it — the product's own try-on page on this site (the demo: the demo page)
  const link = refs ? `${here.origin}/p/${encodeURIComponent(refs.store)}/${encodeURIComponent(refs.product)}` : null;
  const fallback: Pairing = { brand: null, product: null, kind: asked.kind ?? 'watch', link };
  if (refs) {
    const local = isLocalHost(here.hostname);
    // on this computer the frame reads this app's own configs unless it names another local server (as the embed page)
    const base = configBase(refs.base ?? (local ? `${here.origin}/v1` : null), local);
    try {
      const response = await fetcher(configUrl(base, refs.store, refs.product), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(2000) });
      const found = response.ok ? pairingFromConfig(await response.json(), local) : null;
      return found ? { ...found, kind: found.product ? found.kind : fallback.kind, link } : fallback;
    } catch {
      return fallback;
    }
  }
  const demo = demoPairing(asked.demo);
  return demo ? { ...demo, link: `${here.origin}/demo` } : fallback;
}
