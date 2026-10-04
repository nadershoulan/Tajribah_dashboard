import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { ZidPage } from '@site/components/pages/PlatformLanding';

export const metadata: Metadata = pageMeta('/zid');

export default function Page() {
  return <ZidPage />;
}
