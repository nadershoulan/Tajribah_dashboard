import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { SallaPage } from '@/components/pages/PlatformLanding';

export const metadata: Metadata = pageMeta('/salla');

export default function Page() {
  return <SallaPage />;
}
