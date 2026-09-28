import type { MetadataRoute } from 'next';
import { COMPANY } from '@/lib/site';

/** M12 — crawl the site, not the pairing API, a phone's one-time capture page, or the try-on frame (P5). */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/capture/', '/embed/'] }],
    sitemap: `${COMPANY.siteUrl}/sitemap.xml`,
  };
}
