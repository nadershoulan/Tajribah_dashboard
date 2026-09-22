import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { LangProvider } from '@/lib/i18n';
import { langFromCookie } from '@/lib/lang';

export const metadata: Metadata = {
  title: { default: 'تجربة Tajribah — جرّبها قبل أن تشتريها', template: '%s | تجربة Tajribah' },
  description:
    'تجربة افتراضية ومقارنة بالحجم الحقيقي لمتاجر الساعات والمجوهرات والإكسسوارات في السعودية. عربية أولًا، ومن دون تطبيق.',
  applicationName: 'Tajribah',
  icons: {
    icon: [
      { url: '/brand/favicon.ico', sizes: 'any' },
      { url: '/brand/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/brand/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: '/brand/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'تجربة Tajribah',
    locale: 'ar_SA',
    alternateLocale: ['en_US'],
    images: [{ url: '/brand/og-image.png', width: 1200, height: 630, alt: 'تجربة Tajribah' }],
  },
  twitter: { card: 'summary_large_image', images: ['/brand/og-image.png'] },
};

export const viewport: Viewport = { themeColor: '#0A2237', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Arabic unless this visitor has chosen English before.
  const lang = langFromCookie((await headers()).get('cookie'));
  return (
    <html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Readex+Pro:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">
        <LangProvider initial={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
