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
