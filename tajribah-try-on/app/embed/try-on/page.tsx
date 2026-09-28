import type { Metadata } from 'next';
import EmbedTryOn from '@/components/pages/EmbedTryOn';

// P5 (T26) — opened in a frame over a merchant's product page; not a site page.
export const metadata: Metadata = { title: 'Tajribah try-on', robots: { index: false, follow: false } };

export default function Page() {
  return <EmbedTryOn />;
}
