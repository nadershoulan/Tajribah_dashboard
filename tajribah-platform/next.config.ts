import type { NextConfig } from "next";
import { API_CSP, SECURITY_HEADERS } from "./server/core/http/security-headers";
import { SITE_PAGES } from "./lib/site-paths";

/**
 * The website's pages may use the camera on this origin (the try-on's "on me", the phone capture);
 * the dashboard never does (P7.7). vinext keeps the FIRST value of a header (Next.js the last), so
 * these rules come before the site-wide one. Framing is the page policy's (proxy.ts): the website's
 * allows any https page to frame /embed/*, and browsers ignore X-Frame-Options once a policy says
 * frame-ancestors.
 */
const SITE_PERMISSIONS = { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" };
const sitePageRules = SITE_PAGES.filter((page) => page.startsWith("/") && !page.includes("."))
  .map((page) => ({ source: page.replace(/\[([^\]]+)\]/g, ":$1"), headers: [SITE_PERMISSIONS] }));

const nextConfig: NextConfig = {
  // P7.7: every response carries the security headers; pages get their policy from proxy.ts.
  async headers() {
    return [
      ...sitePageRules,
      // vinext reads `/:path*` as one segment or more: `/` needs its own rule. It also keeps the
      // FIRST value of a header (Next.js the last), so rules must not give one header two values.
      { source: "/", headers: SECURITY_HEADERS },
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
    ];
  },
};

export default nextConfig;
