import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import Contact from '@site/components/pages/Contact';

export const metadata: Metadata = pageMeta('/contact');

export default function Page() {
  return <Contact />;
}
