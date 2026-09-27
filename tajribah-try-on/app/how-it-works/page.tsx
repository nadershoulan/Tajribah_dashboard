import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import HowItWorks from '@/components/pages/HowItWorks';

export const metadata: Metadata = pageMeta('/how-it-works');

export default function Page() {
  return <HowItWorks />;
}
