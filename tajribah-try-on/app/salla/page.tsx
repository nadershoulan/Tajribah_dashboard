import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { SallaPage } from '@/components/pages/PlatformLanding';

export const metadata: Metadata = { title: TITLES['/salla'].ar };

export default function Page() {
  return <SallaPage />;
}
