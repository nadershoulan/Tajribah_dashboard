import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./server/core/http/security-headers";

const nextConfig: NextConfig = {
  // P7: every response carries the security headers (server/core/http/security-headers.ts).
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
