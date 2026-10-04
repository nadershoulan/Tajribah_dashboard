import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { CookiesPage } from '@site/components/pages/Legal';

export const metadata: Metadata = pageMeta('/cookies');

export default function Page() {
  return <CookiesPage />;
}
