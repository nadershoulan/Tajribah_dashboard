import type { NextConfig } from "next";
import { API_CSP, SECURITY_HEADERS } from "./server/core/http/security-headers";

const nextConfig: NextConfig = {
  // P7.7: every response carries the security headers; pages get their policy from proxy.ts.
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
    ];
  },
};

export default nextConfig;
