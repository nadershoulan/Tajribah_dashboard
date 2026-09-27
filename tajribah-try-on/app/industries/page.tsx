import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { IndustriesIndex } from '@/components/pages/Industries';

export const metadata: Metadata = pageMeta('/industries');

export default function Page() {
  return <IndustriesIndex />;
}
