import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import DevelopersPage from '@/components/pages/Developers';

export const metadata: Metadata = pageMeta('/developers');

export default function Page() {
  return <DevelopersPage />;
}
