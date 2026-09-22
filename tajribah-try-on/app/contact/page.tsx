import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import Contact from '@/components/pages/Contact';

export const metadata: Metadata = { title: TITLES['/contact'].ar };

export default function Page() {
  return <Contact />;
}
