import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import DevelopersPage from '@site/components/pages/Developers';

export const metadata: Metadata = pageMeta('/developers');

export default function Page() {
  return <DevelopersPage />;
}
