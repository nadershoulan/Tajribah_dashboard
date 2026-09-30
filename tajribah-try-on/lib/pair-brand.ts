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
