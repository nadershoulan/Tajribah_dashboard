import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { ZidPage } from '@/components/pages/PlatformLanding';

export const metadata: Metadata = pageMeta('/zid');

export default function Page() {
  return <ZidPage />;
}
