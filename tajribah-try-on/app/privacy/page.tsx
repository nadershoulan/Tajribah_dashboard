import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { PrivacyPage } from '@/components/pages/Legal';

export const metadata: Metadata = pageMeta('/privacy');

export default function Page() {
  return <PrivacyPage />;
}
