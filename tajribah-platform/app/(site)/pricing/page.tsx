import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import Pricing from '@site/components/pages/Pricing';

export const metadata: Metadata = pageMeta('/pricing');

export default function Page() {
  return <Pricing />;
}
