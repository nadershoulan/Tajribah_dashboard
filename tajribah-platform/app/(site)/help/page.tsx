import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { HelpIndex } from '@site/components/pages/Resources';

export const metadata: Metadata = pageMeta('/help');

export default function Page() {
  return <HelpIndex />;
}
