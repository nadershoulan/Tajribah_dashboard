'use client';

import { useLang } from '@/lib/i18n';
import { SiteLink } from '@/lib/site-env';
import { Shell } from '@/components/site/chrome';
import { Frame } from '@/components/site/ui';

export default function NotFound() {
  const { t } = useLang();
  return (
    <Shell>
      <section className="sec">
        <div className="wrap narrow center-text not-found">
          <Frame className="nf-frame"><span className="nf-code" dir="ltr">404</span></Frame>
          <h1 className="h2">{t('لم نجد هذه الصفحة', 'We couldn’t find this page')}</h1>
          <p className="lead">{t('ربما تغيّر الرابط أو كُتب بشكل مختلف.', 'The link may have changed or been typed differently.')}</p>
          <div className="hero-actions center">
            <SiteLink href="/" className="btn btn-primary">{t('العودة إلى الرئيسية', 'Back to home')}</SiteLink>
            <SiteLink href="/demo" className="btn btn-ghost">{t('جرّب العرض التجريبي', 'Try the live demo')}</SiteLink>
          </div>
        </div>
      </section>
    </Shell>
  );
}
