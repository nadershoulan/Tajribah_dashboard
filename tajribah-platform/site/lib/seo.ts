import type { Metadata } from 'next';
import { TITLES } from './site';

/**
 * M12 — per-page metadata: title, canonical and social-sharing card. Paths are relative and
 * resolve against `metadataBase` (COMPANY.siteUrl, from NEXT_PUBLIC_SITE_URL), so nothing here
 * changes when the domain is settled.
 *
 * A page's `openGraph` *replaces* the layout's in Next rather than merging with it, so the site
 * name, locale and image are repeated here — otherwise every page would lose its share image.
 */
const OG_BASE = {
  type: 'website' as const,
  siteName: 'تجربة Tajribah',
  locale: 'ar_SA',
  alternateLocale: ['en_US'],
  images: [{ url: '/brand/og-image.png', width: 1200, height: 630, alt: 'تجربة Tajribah' }],
};

export function pageMeta(path: string, override: { title?: string; description?: string } = {}): Metadata {
  const title = override.title ?? TITLES[path]?.ar ?? 'تجربة Tajribah';
  return {
    title,
    ...(override.description ? { description: override.description } : {}),
    alternates: { canonical: path },
    openGraph: { ...OG_BASE, title, url: path, ...(override.description ? { description: override.description } : {}) },
  };
}

/**
 * SEO, 2026-10-08 — robots.txt. Served by an explicit route (`app/(site)/robots.txt/route.ts`): the metadata-file
 * form (`robots.ts`) lost to the dashboard's catch-all route on the live site, which answered with an HTML page.
 * Crawl the website; not the API, a phone's one-time capture page, the try-on frame or the signed-in dashboard.
 */
export function robotsTxt(siteUrl: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /capture/',
    'Disallow: /embed/',
    'Disallow: /dashboard',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

/** The web app manifest: Arabic first, the brand's colours and icons (installable, and read by search engines). */
export function webManifest() {
  return {
    name: 'تجربة Tajribah',
    short_name: 'تجربة',
    description: 'تجربة افتراضية ومقارنة بالحجم الحقيقي لمتاجر الساعات والمجوهرات والإكسسوارات في السعودية.',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'browser',
    background_color: '#FFFFFF',
    theme_color: '#0A2237',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}

/** Structured data: who runs the site (brand only — Nader, 2026-10-08) and the site itself, so search shows "تجربة". */
export function structuredData(siteUrl: string) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Tajribah',
      alternateName: 'تجربة',
      url: siteUrl,
      logo: `${siteUrl}/brand/tajribah-logo.png`,
      address: { '@type': 'PostalAddress', addressCountry: 'SA' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'تجربة',
      alternateName: ['Tajribah', 'تجربة Tajribah'],
      url: siteUrl,
      inLanguage: ['ar', 'en'],
    },
  ];
}
