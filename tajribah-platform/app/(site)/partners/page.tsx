import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import PartnersPage from '@site/components/pages/Partners';

export const metadata: Metadata = pageMeta('/partners');

export default function Page() {
  return <PartnersPage />;
}
