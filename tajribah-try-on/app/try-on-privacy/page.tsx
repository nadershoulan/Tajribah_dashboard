import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { TryOnPrivacyPage } from '@/components/pages/Legal';

export const metadata: Metadata = pageMeta('/try-on-privacy');

export default function Page() {
  return <TryOnPrivacyPage />;
}
