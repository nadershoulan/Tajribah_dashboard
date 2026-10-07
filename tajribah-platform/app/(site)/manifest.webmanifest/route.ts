// SEO — the web app manifest (site/lib/seo.ts).
import { webManifest } from '@site/lib/seo';

export function GET(): Response {
  return new Response(JSON.stringify(webManifest()), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
}
