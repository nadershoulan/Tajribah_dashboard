import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // P5 (T26): the try-on frame opens over merchants' product pages, so it — and only it — may be
  // framed by any https page, and may ask for the camera. Every other page refuses framing.
  async headers() {
    return [
      { source: '/:path*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] },
      { source: '/embed/:path*', headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors https:' }, { key: 'Permissions-Policy', value: 'camera=(self)' }] },
    ];
  },
};

export default nextConfig;
