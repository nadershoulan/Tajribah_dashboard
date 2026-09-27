import type { MetadataRoute } from 'next';
import { COMPANY } from '@/lib/site';

/** M12 — crawl the site, not the pairing API or a phone's one-time capture page. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/capture/'] }],
    sitemap: `${COMPANY.siteUrl}/sitemap.xml`,
  };
}
