import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { CookiesPage } from '@/components/pages/Legal';

export const metadata: Metadata = { title: TITLES['/cookies'].ar };

export default function Page() {
  return <CookiesPage />;
}
