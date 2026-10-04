import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import Integrations from '@site/components/pages/Integrations';

export const metadata: Metadata = pageMeta('/integrations');

export default function Page() {
  return <Integrations />;
}
