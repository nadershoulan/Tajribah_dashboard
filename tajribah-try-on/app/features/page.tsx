import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import Features from '@/components/pages/Features';

export const metadata: Metadata = { title: TITLES['/features'].ar };

export default function Page() {
  return <Features />;
}
