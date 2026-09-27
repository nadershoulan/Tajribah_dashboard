import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { TermsPage } from '@/components/pages/Legal';

export const metadata: Metadata = pageMeta('/terms');

export default function Page() {
  return <TermsPage />;
}
