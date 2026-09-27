import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { StoriesPage } from '@/components/pages/Resources';

export const metadata: Metadata = pageMeta('/customers');

export default function Page() {
  return <StoriesPage />;
}
