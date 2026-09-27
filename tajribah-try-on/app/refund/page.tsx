import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { RefundPage } from '@/components/pages/Legal';

export const metadata: Metadata = pageMeta('/refund');

export default function Page() {
  return <RefundPage />;
}
