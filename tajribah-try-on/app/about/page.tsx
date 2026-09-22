import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import About from '@/components/pages/About';

export const metadata: Metadata = { title: TITLES['/about'].ar };

export default function Page() {
  return <About />;
}
