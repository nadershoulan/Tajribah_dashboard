import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { SallaPage } from '@site/components/pages/PlatformLanding';

export const metadata: Metadata = pageMeta('/salla');

export default function Page() {
  return <SallaPage />;
}
