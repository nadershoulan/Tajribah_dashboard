import type { Metadata } from 'next';
import NotFound from '@site/components/pages/NotFound';

export const metadata: Metadata = { title: 'الصفحة غير موجودة' };

export default function NotFoundPage() {
  return <NotFound />;
}
