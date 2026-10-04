import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { PrivacyPage } from '@site/components/pages/Legal';

export const metadata: Metadata = pageMeta('/privacy');

export default function Page() {
  return <PrivacyPage />;
}
