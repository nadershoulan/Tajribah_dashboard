import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { CookiesPage } from '@/components/pages/Legal';

export const metadata: Metadata = pageMeta('/cookies');

export default function Page() {
  return <CookiesPage />;
}
