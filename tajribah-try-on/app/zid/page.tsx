import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { ZidPage } from '@/components/pages/PlatformLanding';

export const metadata: Metadata = { title: TITLES['/zid'].ar };

export default function Page() {
  return <ZidPage />;
}
