import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { HelpIndex } from '@/components/pages/Resources';

export const metadata: Metadata = pageMeta('/help');

export default function Page() {
  return <HelpIndex />;
}
