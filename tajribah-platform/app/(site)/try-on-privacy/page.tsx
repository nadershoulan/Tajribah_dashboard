import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { TryOnPrivacyPage } from '@site/components/pages/Legal';

export const metadata: Metadata = pageMeta('/try-on-privacy');

export default function Page() {
  return <TryOnPrivacyPage />;
}
