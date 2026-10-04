import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import HowItWorks from '@site/components/pages/HowItWorks';

export const metadata: Metadata = pageMeta('/how-it-works');

export default function Page() {
  return <HowItWorks />;
}
