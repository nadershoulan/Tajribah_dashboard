import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import Pricing from '@/components/pages/Pricing';

export const metadata: Metadata = pageMeta('/pricing');

export default function Page() {
  return <Pricing />;
}
