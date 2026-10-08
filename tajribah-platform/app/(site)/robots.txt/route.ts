// SEO — /robots.txt as an explicit route (see robotsTxt in site/lib/seo.ts for why not robots.ts).
import { COMPANY } from '@site/lib/site';
import { robotsTxt } from '@site/lib/seo';

export function GET(): Response {
  return new Response(robotsTxt(COMPANY.siteUrl, { noindex: process.env.SITE_NOINDEX === '1' }), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
