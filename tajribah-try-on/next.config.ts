import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // P5 (T26): the try-on frame opens over merchants' product pages, so it — and only it — may be
  // framed by any https page, and may ask for the camera. Every other page refuses framing.
  //
  // vinext applies header rules FIRST-MATCH-WINS per header (Next.js is last-wins): with the
  // site-wide rule first, /embed/* was sent `frame-ancestors 'none'` and the frame was blank on
  // every shop (found on the production build, P5.12). So the /embed/* rule comes first, and the
  // site-wide rule uses CSP alone — `X-Frame-Options: DENY` would still reach /embed/* (the embed
  // rule has no value for it: there is no "allow"). CSP frame-ancestors is what every browser the
  // site runs in enforces (Chrome 40+, Firefox 33+, Safari 10+).
  async headers() {
    return [
      { source: '/embed/:path*', headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors https:' }, { key: 'Permissions-Policy', value: 'camera=(self)' }] },
      // vinext reads `/:path*` as one segment or more, so it never matched the home page: `/` on its own.
      { source: '/', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] },
      { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] },
    ];
  },
};

export default nextConfig;
