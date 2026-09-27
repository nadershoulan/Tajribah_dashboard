import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { CareersPage } from '@/components/pages/Resources';

export const metadata: Metadata = pageMeta('/careers');

export default function Page() {
  return <CareersPage />;
}
