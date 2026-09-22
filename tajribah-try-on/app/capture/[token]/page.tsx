import type { Metadata } from 'next';
import Capture from './capture';

export const metadata: Metadata = { title: 'تجربتك الخاصة', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Capture token={token} />;
}
