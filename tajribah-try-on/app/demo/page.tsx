import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import Demo from '@/components/pages/Demo';

export const metadata: Metadata = { title: TITLES['/demo'].ar };

export default function Page() {
  return <Demo />;
}
