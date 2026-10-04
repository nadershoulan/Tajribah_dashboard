import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { RefundPage } from '@site/components/pages/Legal';

export const metadata: Metadata = pageMeta('/refund');

export default function Page() {
  return <RefundPage />;
}
