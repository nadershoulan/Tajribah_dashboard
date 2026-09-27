import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import FaqPage from '@/components/pages/Faq';

export const metadata: Metadata = pageMeta('/faq');

export default function Page() {
  return <FaqPage />;
}
