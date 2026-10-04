import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { IndustriesIndex } from '@site/components/pages/Industries';

export const metadata: Metadata = pageMeta('/industries');

export default function Page() {
  return <IndustriesIndex />;
}
