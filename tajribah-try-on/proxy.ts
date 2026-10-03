import { NextResponse, type NextRequest } from 'next/server';
import { newNonce, pageCsp } from './lib/security';
import { isLocalHost } from './lib/tryon-config';
import { ANALYTICS_ON } from './lib/analytics';

/**
 * Every page gets its own script nonce and the page policy (`lib/security.ts`). The policy goes on the
 * request as well as the response: that is where the renderer reads the nonce for its inline scripts.
 * API routes and static files are left to `next.config.ts`.
 */
export function proxy(request: NextRequest) {
  const framed = request.nextUrl.pathname.startsWith('/embed/');
  const local = isLocalHost(request.nextUrl.hostname);
  const csp = pageCsp(newNonce(), { dev: process.env.NODE_ENV === 'development', local, framed, analytics: ANALYTICS_ON });
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!api/|assets/|brand/|wasm/|vendor/|_next/|favicon\.ico).*)'],
};
