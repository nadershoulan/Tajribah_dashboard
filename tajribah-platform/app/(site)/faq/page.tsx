import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import FaqPage from '@site/components/pages/Faq';

export const metadata: Metadata = pageMeta('/faq');

export default function Page() {
  return <FaqPage />;
}
