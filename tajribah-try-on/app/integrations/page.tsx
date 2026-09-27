import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import Integrations from '@/components/pages/Integrations';

export const metadata: Metadata = pageMeta('/integrations');

export default function Page() {
  return <Integrations />;
}
