import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import '../globals.css';
import { dirOf, langFromCookie } from '@/lib/lang';
import { themeAttribute, themeFromCookie } from '@/lib/theme';
import { NextProviders } from '@/components/next-shell';

export const metadata: Metadata = {
  title: { default: 'لوحة تجربة — Tajribah Dashboard', template: '%s | تجربة Tajribah' },
  applicationName: 'Tajribah',
  robots: { index: false, follow: false },
  icons: { icon: [{ url: '/brand/favicon.ico', sizes: 'any' }] },
};

export const viewport: Viewport = { themeColor: '#0A2237', colorScheme: 'light dark', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Arabic and right-to-left unless this person chose English before (§11).
  const cookie = (await headers()).get('cookie');
  const lang = langFromCookie(cookie);
  // Light or dark as this person picked; otherwise no attribute, and the device decides.
  return (
    <html lang={lang} dir={dirOf(lang)} data-theme={themeAttribute(themeFromCookie(cookie))}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Readex+Pro:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">
        <NextProviders initialLang={lang}>{children}</NextProviders>
      </body>
    </html>
  );
}
