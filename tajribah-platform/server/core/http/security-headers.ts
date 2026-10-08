/**
 * P7.7 — security headers on every response (the app had none).
 *
 * Nothing in this app is meant to be framed: the storefront widget is a script on the merchant's
 * page, not an iframe of ours. So framing is refused everywhere — the staff console's store and
 * account actions, and the merchant's billing, cannot be click-jacked from another site. One page is
 * the exception (T61): `/salla/app`, which Salla's merchant dashboard (`https://s.salla.sa`) loads in
 * a frame — that host only, by its policy's `frame-ancestors` (browsers then ignore X-Frame-Options).
 * The page asks for nothing but Salla's word on who opened it, and opens Tajribah in its own tab.
 *
 * Two Content-Security-Policies, because pages and the API need different things:
 *  - **Pages** get `pageCsp(nonce)` from `proxy.ts`, a fresh nonce per request. The framework
 *    streams its data to the browser in inline scripts (a hundred on the sign-in page); vinext
 *    reads the nonce from the request's policy and puts it on every one of them, so no
 *    `'unsafe-inline'` for scripts. `'strict-dynamic'` lets those trusted scripts load the
 *    app's chunks (and the QR code library on the security screen).
 *  - **The API** answers JSON and files, never HTML, so it gets `API_CSP`: nothing at all.
 * `X-Frame-Options` stays on every response as the backstop if the proxy ever misses a page.
 */
export type Header = { key: string; value: string };

export const SECURITY_HEADERS: Header[] = [
  { key: 'X-Frame-Options', value: 'DENY' }, // for browsers that predate frame-ancestors
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Browsers ignore HSTS over plain http, so local development is unaffected.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // The dashboard never uses these; the shopper's camera runs on the merchant's page, not here.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

/** JSON and file downloads load nothing, run nothing and are framed by no one. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * The policy for an HTML page. `dev` adds only what Vite's dev server needs (its hot-reload
 * socket and React's dev-time `eval` for readable stacks); a build never carries them.
 */
/** The page Salla's merchant dashboard frames (T61), and the one host allowed to frame it. */
export const SALLA_APP_PATH = '/salla/app';
export const SALLA_DASHBOARD = 'https://s.salla.sa';

export function pageCsp(nonce: string, { dev = false, framedBy, local = false, lanHost }: { dev?: boolean; framedBy?: string; local?: boolean; lanHost?: string } = {}): string {
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets WebAssembly compile (the meshopt decoder in the staff model review,
    // P3.6); it does not allow eval of JavaScript.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
    // React's `style` props become style attributes, which only 'unsafe-inline' allows. Styles
    // cannot run code; scripts are the ones held to the nonce.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // data: for the two-step QR code (drawn in the browser); blob: for CSV and JSON downloads.
    // T79: https: for products' own pictures, which live on each store's CDN (cdn.salla.sa, a Shopify or
    // WooCommerce host…) — any of thousands. A picture cannot run code; scripts stay held to the nonce.
    `img-src 'self' data: blob: https:${local ? ` http://localhost:* http://127.0.0.1:*${lanHost ? ` http://${lanHost}:*` : ''}` : ''}`,
    // 3D models upload straight to R2 with a presigned PUT (P1.12); blob: is the reviewer's model,
    // fetched with the session and handed to the viewer (P3.6).
    // `local`: a page served from this computer may also upload to storage running on it (an S3 server
    // such as SeaweedFS, docs/DATABASE.md); a page on a real address never is local.
    `connect-src 'self' blob: https://*.r2.cloudflarestorage.com${local ? ` http://localhost:* http://127.0.0.1:*${lanHost ? ` http://${lanHost}:*` : ''}` : ''}${dev ? ' ws: wss:' : ''}`,
    // T120: Cloudflare Turnstile's challenge frame on the sign-in and sign-up screens (its script comes through
    // 'strict-dynamic', loaded by the app's own trusted code). Nothing else may be framed in.
    "frame-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${framedBy ?? "'none'"}`,
  ].join('; ');
}

/** 128 random bits, base64 — a new one for every page served. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
