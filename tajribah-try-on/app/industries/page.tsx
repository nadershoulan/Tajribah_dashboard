import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { IndustriesIndex } from '@/components/pages/Industries';

export const metadata: Metadata = { title: TITLES['/industries'].ar };

export default function Page() {
  return <IndustriesIndex />;
}
