/**
 * Visits to a product's own page (P1.19), counted in the merchant's Analytics like the shop widget's
 * events — the sending half; showing the counts is the analytics session's (proposed to them).
 *
 * The same batch the widget sends to the collector (`tajribah-platform/widget/src/track.ts`, copied,
 * not imported — this site never reaches into the platform's code): schema 1, the store, a random
 * per-tab session token in `sessionStorage` (the same key as the widget's), and the events. Each
 * carries `properties.surface = 'page'` — a visit to the product page, not to the shop — and `via`:
 * 'qr' when the page was opened from a QR code (`?s=qr`), else 'link'.
 *
 * Anonymous, like the widget's: no cookie, no identity, nothing when the browser signals Do Not Track
 * or Global Privacy Control. `text/plain` and `sendBeacon` keep it a simple request (no preflight).
 * Never throws into the page.
 */
export const EVENTS_ENDPOINT = 'https://ev.tajribah.org/v1/e';
export const PAGE_SDK = 'page-1';
const SCHEMA = 1;
const SESSION_KEY = 'tj_s';

export type PageEvent = 'product_view' | 'ar_open' | 'tryon_start';

export function viaOf(search: string): 'qr' | 'link' {
  return new URLSearchParams(search).get('s') === 'qr' ? 'qr' : 'link';
}

export function noTracking(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean }, win?: { doNotTrack?: string | null }): boolean {
  const dnt = nav.doNotTrack ?? win?.doNotTrack;
  return dnt === '1' || dnt === 'yes' || nav.globalPrivacyControl === true;
}

function session(): string {
  try {
    const found = sessionStorage.getItem(SESSION_KEY);
    if (found && /^[A-Za-z0-9_-]{16,64}$/.test(found)) return found;
  } catch { /* blocked storage */ }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const made = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try { sessionStorage.setItem(SESSION_KEY, made); } catch { /* this tab still sends one token */ }
  return made;
}

/** The batch for one event — exported for the test that holds it to the collector's schema. */
export function pageBatch(store: string, product: string, type: PageEvent, via: 'qr' | 'link', sessionToken: string, now: number) {
  return {
    v: SCHEMA, store, session: sessionToken, sdk: PAGE_SDK, sentAt: now,
    events: [{ type, t: 0, productId: product.slice(0, 200), properties: { surface: 'page', via } }],
  };
}

/** Send one event about this product page; quietly nothing when tracking is declined or unavailable. */
export function trackPage(store: string, product: string, type: PageEvent, endpoint = EVENTS_ENDPOINT): void {
  try {
    if (typeof window === 'undefined' || noTracking(navigator as never, window as never)) return;
    const body = JSON.stringify(pageBatch(store, product, type, viaOf(location.search), session(), Date.now()));
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
    if (navigator.sendBeacon?.(endpoint, blob)) return;
    void fetch(endpoint, { method: 'POST', body, keepalive: true, mode: 'no-cors', credentials: 'omit', headers: { 'content-type': 'text/plain;charset=UTF-8' } }).catch(() => undefined);
  } catch { /* never into the page */ }
}
