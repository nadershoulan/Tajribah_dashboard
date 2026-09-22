import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import HowItWorks from '@/components/pages/HowItWorks';

export const metadata: Metadata = { title: TITLES['/how-it-works'].ar };

export default function Page() {
  return <HowItWorks />;
}
