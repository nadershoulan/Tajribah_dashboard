import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import About from '@site/components/pages/About';

export const metadata: Metadata = pageMeta('/about');

export default function Page() {
  return <About />;
}
