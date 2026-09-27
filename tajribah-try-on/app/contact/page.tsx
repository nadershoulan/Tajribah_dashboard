import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import Contact from '@/components/pages/Contact';

export const metadata: Metadata = pageMeta('/contact');

export default function Page() {
  return <Contact />;
}
