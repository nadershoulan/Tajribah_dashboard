import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import Demo from '@site/components/pages/Demo';

export const metadata: Metadata = pageMeta('/demo');

export default function Page() {
  return <Demo />;
}
