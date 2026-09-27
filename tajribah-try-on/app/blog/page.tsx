import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { BlogIndex } from '@/components/pages/Resources';

export const metadata: Metadata = pageMeta('/blog');

export default function Page() {
  return <BlogIndex />;
}
