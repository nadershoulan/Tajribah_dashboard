import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { TermsPage } from '@site/components/pages/Legal';

export const metadata: Metadata = pageMeta('/terms');

export default function Page() {
  return <TermsPage />;
}
