import { NextResponse, type NextRequest } from "next/server";
import { newNonce, pageCsp, SALLA_APP_PATH, SALLA_DASHBOARD } from "./server/core/http/security-headers";
import { isSitePath } from "./lib/site-paths";
import { pageCsp as sitePageCsp } from "./site/lib/security";
import { isLocalHost } from "./site/lib/tryon-config";
import { siteGaId } from "./site/lib/site-settings";

/**
 * P7.7 — every page gets its own script nonce and the page policy.
 *
 * Two kinds of page since the website moved in (from tajribah-try-on): the website's pages
 * (`lib/site-paths.ts`) keep the website's policy (`site/lib/security.ts`: GA when an id is set, the
 * try-on's camera and wasm, framing for /embed); every other page gets the dashboard's
 * (server/core/http/security-headers.ts). The policy goes on the request as well as the response:
 * that is where the renderer reads the nonce to stamp its own inline scripts. The API and static
 * files are left to `next.config.ts`.
 */
export async function proxy(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;
  const dev = process.env.NODE_ENV === "development";
  let csp: string;
  if (isSitePath(pathname)) {
    // T69: GA4 may send from the website when staff set its id, and from a product's own page when its
    // store set one (the page loads it only after the shopper agrees; the policy cannot know the store's).
    const analytics = pathname.startsWith("/p/") || (await siteGaId()) !== null;
    csp = sitePageCsp(newNonce(), { dev, local: isLocalHost(hostname), framed: pathname.startsWith("/embed/"), analytics });
  } else {
    // T61: the Salla app page is framed by Salla's merchant dashboard, and by nothing else.
    const framedBy = pathname.replace(/\/$/, "") === SALLA_APP_PATH ? SALLA_DASHBOARD : undefined;
    csp = pageCsp(newNonce(), { dev, framedBy, local: isLocalHost(hostname) });
  }
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!api/|v1/|brand/|assets/|wasm/|vendor/|_next/|favicon\.ico).*)"],
};
