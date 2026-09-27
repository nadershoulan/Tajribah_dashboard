import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { CareersPage } from '@/components/pages/Resources';

export const metadata: Metadata = { title: TITLES['/careers'].ar };

export default function Page() {
  return <CareersPage />;
}
