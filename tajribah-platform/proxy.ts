import { NextResponse, type NextRequest } from "next/server";
import { newNonce, pageCsp, SALLA_APP_PATH, SALLA_DASHBOARD } from "./server/core/http/security-headers";

/**
 * P7.7 — every page gets its own script nonce and the page policy (server/core/http/security-headers.ts).
 *
 * The policy goes on the request as well as the response: that is where the renderer reads the
 * nonce to stamp its own inline scripts. The API and static files are left to `next.config.ts`.
 */
export function proxy(request: NextRequest) {
  // T61: the Salla app page is framed by Salla's merchant dashboard, and by nothing else.
  const framedBy = request.nextUrl.pathname.replace(/\/$/, "") === SALLA_APP_PATH ? SALLA_DASHBOARD : undefined;
  const csp = pageCsp(newNonce(), { dev: process.env.NODE_ENV === "development", framedBy });
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!api/|brand/|assets/|vendor/|_next/|favicon\.ico).*)"],
};
