import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import PartnersPage from '@/components/pages/Partners';

export const metadata: Metadata = pageMeta('/partners');

export default function Page() {
  return <PartnersPage />;
}
