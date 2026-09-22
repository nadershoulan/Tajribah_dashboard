import type { Metadata } from 'next';
import { TITLES } from '@/lib/site';
import Integrations from '@/components/pages/Integrations';

export const metadata: Metadata = { title: TITLES['/integrations'].ar };

export default function Page() {
  return <Integrations />;
}
