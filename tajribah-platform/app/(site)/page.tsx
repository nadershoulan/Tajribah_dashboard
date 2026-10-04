import type { Metadata } from 'next';
import Home from '@site/components/pages/Home';

// The layout's default title is the home title; only the canonical is added (M12).
export const metadata: Metadata = { alternates: { canonical: '/' } };


export default function Page() {
  return <Home />;
}
