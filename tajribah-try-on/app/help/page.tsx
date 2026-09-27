import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { HelpIndex } from '@/components/pages/Resources';

export const metadata: Metadata = { title: TITLES['/help'].ar };

export default function Page() {
  return <HelpIndex />;
}
