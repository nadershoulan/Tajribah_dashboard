import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { PrivacyPage } from '@/components/pages/Legal';

export const metadata: Metadata = { title: TITLES['/privacy'].ar };

export default function Page() {
  return <PrivacyPage />;
}
