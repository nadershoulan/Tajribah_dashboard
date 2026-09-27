import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { StoriesPage } from '@/components/pages/Resources';

export const metadata: Metadata = { title: TITLES['/customers'].ar };

export default function Page() {
  return <StoriesPage />;
}
