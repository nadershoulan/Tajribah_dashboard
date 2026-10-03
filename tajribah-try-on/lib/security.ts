/**
 * The website's page policy (P7.7 for the shop-facing pages): every page gets a fresh script nonce
 * (`proxy.ts`), and runs only the code it was sent with — a script slipped into a page is refused.
 * The framework streams its data in inline scripts; vinext reads the nonce from the request's policy
 * and stamps each of them, so scripts need no 'unsafe-inline'. 'strict-dynamic' lets those trusted
 * scripts load the site's chunks, the 3D viewer (from Tajribah's file host) and MediaPipe's loader.
 *
 * What the pages need, and why:
 *  - images from any https address: merchants' watch pictures (the file host) and an Enterprise
 *    store's own logo (any https address it set); data:/blob: for the studio's canvas and saved picture.
 *  - connect to the config host (the browser's fallback read), the file host (3D files), ourselves
 *    (pairing); blob:/data: for pictures handed to the studio.
 *  - 'wasm-unsafe-eval' compiles WebAssembly (MediaPipe's hand detection, the meshopt decoder); it
 *    does not allow eval of JavaScript. Workers from blob: (MediaPipe).
 *  - the camera is the studio's own (Permissions-Policy, `next.config.ts`).
 *  - frame-ancestors: the try-on frame opens over merchants' https pages; nothing else is framed.
 * On this machine (`local`) the local test servers are allowed too; a public page never is local.
 */
export const CONFIG_HOST = 'https://cfg.tajribah.com';
export const FILE_HOST = 'https://cdn.tajribah.com';

export function pageCsp(nonce: string, { dev = false, local = false, framed = false }: { dev?: boolean; local?: boolean; framed?: boolean } = {}): string {
  const here = local ? ' http://localhost:* http://127.0.0.1:*' : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: https:${here}`,
    `connect-src 'self' blob: data: ${CONFIG_HOST} ${FILE_HOST}${here}${dev ? ' ws: wss:' : ''}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${framed ? 'https:' : "'none'"}`,
  ].join('; ');
}

/** 128 random bits, base64 — a new one for every page served. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
