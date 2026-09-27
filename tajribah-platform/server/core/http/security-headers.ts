/**
 * P7 — security headers on every response (the app had none).
 *
 * Nothing in this app is meant to be framed: the storefront widget is a script on the merchant's
 * page, not an iframe of ours. So framing is refused everywhere — the staff console's store and
 * account actions, and the merchant's billing, cannot be click-jacked from another site.
 *
 * The Content-Security-Policy is deliberately narrow for now: only directives that cannot break a
 * working page (framing, <base>, plugins, where forms post). A full script/style policy needs an
 * audit of the fonts and React's inline styles first — filed, not guessed.
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: 'X-Frame-Options', value: 'DENY' }, // for browsers that predate frame-ancestors
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Browsers ignore HSTS over plain http, so local development is unaffected.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // The dashboard never uses these; the shopper's camera runs on the merchant's page, not here.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];
