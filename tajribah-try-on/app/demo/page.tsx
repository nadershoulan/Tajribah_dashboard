import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import Demo from '@/components/pages/Demo';

export const metadata: Metadata = pageMeta('/demo');

export default function Page() {
  return <Demo />;
}
