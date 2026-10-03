import { NextResponse, type NextRequest } from 'next/server';
import { newNonce, pageCsp } from './lib/security';
import { isLocalHost } from './lib/tryon-config';
import { siteGaId } from './lib/site-settings';

/**
 * Every page gets its own script nonce and the page policy (`lib/security.ts`). The policy goes on the
 * request as well as the response: that is where the renderer reads the nonce for its inline scripts.
 * API routes and static files are left to `next.config.ts`.
 */
export async function proxy(request: NextRequest) {
  const framed = request.nextUrl.pathname.startsWith('/embed/');
  const local = isLocalHost(request.nextUrl.hostname);
  // T69: GA4 may send from the website when staff set its id, and from a product's own page when its
  // store set one (the page loads it only after the shopper agrees; the policy cannot know the store's).
  const analytics = request.nextUrl.pathname.startsWith('/p/') || (await siteGaId()) !== null;
  const csp = pageCsp(newNonce(), { dev: process.env.NODE_ENV === 'development', local, framed, analytics });
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!api/|assets/|brand/|wasm/|vendor/|_next/|favicon\.ico).*)'],
};
