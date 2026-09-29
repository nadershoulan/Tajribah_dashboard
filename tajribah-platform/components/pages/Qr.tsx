'use client';

// MD-110 — QR codes (P1.20, waiting on the short domain)

import { QrCode } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { Shell } from '@/components/dashboard/chrome';
import { PageHead, Panel } from '@/components/dashboard/ui';

/**
 * T52 — the sidebar has always listed QR codes, and the link led to "page not found". The screen
 * is waiting for a reason worth saying: a printed code is permanent, so it must carry the final
 * short domain, which does not exist yet (P1.20). Until then this page says so, and points at what
 * already puts the product in front of a shopper.
 */
export default function Qr() {
  const { t } = useLang();
  return (
    <Shell tenant={null} crumbs={[{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('رموز QR', 'QR codes') }]}>
      <PageHead
        title={t('رموز QR', 'QR codes')}
        lead={t('رمز لكل منتج تطبعه على الملصق أو في المتجر، يفتح العرض ثلاثي الأبعاد مباشرة.', 'A code for each product to print on a label or in-store, opening its 3D view directly.')}
      />
      <Panel title={t('ليست متاحة بعد', 'Not available yet')} actions={<QrCode size={20} aria-hidden style={{ color: 'var(--text-3)' }} />}>
        <p style={{ marginTop: 0 }}>{t(
          'الرمز المطبوع يبقى كما هو لسنوات، لذلك يجب أن يحمل عنوان تجربة القصير النهائي. هذا العنوان لم يُعتمد بعد، ورمز يُطبع على عنوان مؤقت يتوقف عن العمل حين يتغيّر.',
          'A printed code stays as it is for years, so it must carry Tajribah’s final short address. That address is not set yet, and a code printed against a temporary one would stop working when it changes.',
        )}</p>
        <p className="hint">{t(
          'إلى ذلك الحين يظهر الزر في صفحات منتجاتك المنشورة.',
          'Until then, the button shows on your published product pages.',
        )}</p>
        <div className="btn-row">
          <AppLink href="/dashboard/ar-settings" className="btn btn-ghost">{t('إعدادات العرض', 'AR settings')}</AppLink>
        </div>
      </Panel>
    </Shell>
  );
}
