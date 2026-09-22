import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { TermsPage } from '@/components/pages/Legal';

export const metadata: Metadata = { title: TITLES['/terms'].ar };

export default function Page() {
  return <TermsPage />;
}
