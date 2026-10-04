import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { BlogIndex } from '@site/components/pages/Resources';

export const metadata: Metadata = pageMeta('/blog');

export default function Page() {
  return <BlogIndex />;
}
