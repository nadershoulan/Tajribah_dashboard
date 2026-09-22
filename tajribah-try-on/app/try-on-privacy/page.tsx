import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { TryOnPrivacyPage } from '@/components/pages/Legal';

export const metadata: Metadata = { title: TITLES['/try-on-privacy'].ar };

export default function Page() {
  return <TryOnPrivacyPage />;
}
