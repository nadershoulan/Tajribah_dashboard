import type { NextConfig } from "next";
import { API_CSP, SECURITY_HEADERS } from "./server/core/http/security-headers";

const nextConfig: NextConfig = {
  // P7.7: every response carries the security headers; pages get their policy from proxy.ts.
  async headers() {
    return [
      // vinext reads `/:path*` as one segment or more: `/` needs its own rule. It also keeps the
      // FIRST value of a header (Next.js the last), so rules must not give one header two values.
      { source: "/", headers: SECURITY_HEADERS },
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
    ];
  },
};

export default nextConfig;
