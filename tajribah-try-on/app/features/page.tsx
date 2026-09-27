import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import Features from '@/components/pages/Features';

export const metadata: Metadata = pageMeta('/features');

export default function Page() {
  return <Features />;
}
