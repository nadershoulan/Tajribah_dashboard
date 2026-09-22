import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import Pricing from '@/components/pages/Pricing';

export const metadata: Metadata = { title: TITLES['/pricing'].ar };

export default function Page() {
  return <Pricing />;
}
