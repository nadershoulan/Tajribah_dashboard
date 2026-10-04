import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { StoriesPage } from '@site/components/pages/Resources';

export const metadata: Metadata = pageMeta('/customers');

export default function Page() {
  return <StoriesPage />;
}
