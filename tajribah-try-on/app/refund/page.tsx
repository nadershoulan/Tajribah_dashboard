import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import { RefundPage } from '@/components/pages/Legal';

export const metadata: Metadata = { title: TITLES['/refund'].ar };

export default function Page() {
  return <RefundPage />;
}
