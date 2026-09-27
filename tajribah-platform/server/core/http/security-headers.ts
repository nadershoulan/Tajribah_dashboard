/**
 * P7.7 — security headers on every response (the app had none).
 *
 * Nothing in this app is meant to be framed: the storefront widget is a script on the merchant's
 * page, not an iframe of ours. So framing is refused everywhere — the staff console's store and
 * account actions, and the merchant's billing, cannot be click-jacked from another site.
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
export function pageCsp(nonce: string, { dev = false }: { dev?: boolean } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // React's `style` props become style attributes, which only 'unsafe-inline' allows. Styles
    // cannot run code; scripts are the ones held to the nonce.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // data: for the two-step QR code (drawn in the browser); blob: for CSV and JSON downloads.
    "img-src 'self' data: blob:",
    // 3D models upload straight to R2 with a presigned PUT (P1.12).
    `connect-src 'self' https://*.r2.cloudflarestorage.com${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** 128 random bits, base64 — a new one for every page served. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
