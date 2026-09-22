import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import FaqPage from '@/components/pages/Faq';

export const metadata: Metadata = { title: TITLES['/faq'].ar };

export default function Page() {
  return <FaqPage />;
}
