import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import Features from '@site/components/pages/Features';

export const metadata: Metadata = pageMeta('/features');

export default function Page() {
  return <Features />;
}
