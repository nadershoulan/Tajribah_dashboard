import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import About from '@/components/pages/About';

export const metadata: Metadata = pageMeta('/about');

export default function Page() {
  return <About />;
}
