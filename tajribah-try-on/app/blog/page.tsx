import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { BlogIndex } from '@/components/pages/Resources';

export const metadata: Metadata = { title: TITLES['/blog'].ar };

export default function Page() {
  return <BlogIndex />;
}
