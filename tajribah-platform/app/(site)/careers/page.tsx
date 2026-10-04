import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { CareersPage } from '@site/components/pages/Resources';

export const metadata: Metadata = pageMeta('/careers');

export default function Page() {
  return <CareersPage />;
}
