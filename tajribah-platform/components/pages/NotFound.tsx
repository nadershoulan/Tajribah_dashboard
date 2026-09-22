'use client';

// SYS-404 — Not found

import { useLang } from '@/lib/i18n';
import { AppLink } from '@/lib/app-env';
import { Shell } from '@/components/dashboard/chrome';
import { Empty } from '@/components/dashboard/ui';

export default function NotFound() {
  const { t } = useLang();
  return (
    <Shell tenant={null} crumbs={[{ label: t('غير موجود', 'Not found') }]}>
      <Empty
        title={t('هذه الصفحة غير موجودة', 'That page does not exist')}
        body={t(
          'ربما تغيّر الرابط، أو أن هذه الشاشة لم تُبنَ بعد. كل ما هو مبني يظهر في القائمة الجانبية.',
          'The link may have changed, or this screen is not built yet. Everything that exists is in the sidebar.',
        )}
        action={<AppLink href="/dashboard" className="btn btn-primary">{t('العودة للرئيسية', 'Back to home')}</AppLink>}
      />
    </Shell>
  );
}
