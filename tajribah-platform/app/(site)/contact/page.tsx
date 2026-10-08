import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import Contact from '@site/components/pages/Contact';

export const metadata: Metadata = pageMeta('/contact');

export default function Page() {
  // T115: the Turnstile site key is public; read at request time so a deploy's setting reaches the page.
  return <Contact turnstileSiteKey={process.env.TURNSTILE_SITE_KEY || null} />;
}
