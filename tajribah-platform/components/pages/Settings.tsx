'use client';

// MD-170 — Store settings

import { useState } from 'react';
import { Building2, Globe, ShieldCheck } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { Shell } from '@/components/dashboard/chrome';
import { Loading, PageHead, Panel } from '@/components/dashboard/ui';

export default function SettingsPage() {
  const { t, lang, setLang } = useLang();
  const { data, loading } = useResource((source) => source.dashboard());

  // Saudi identity fields (§11). Blank until the merchant supplies them — nothing here is
  // pre-filled with a plausible-looking number.
  const [crNumber, setCrNumber] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [address, setAddress] = useState('');

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('الإعدادات', 'Settings') },
  ];

  return (
    <Shell tenant={data?.tenant ?? null} crumbs={crumbs}>
      <PageHead
        title={t('الإعدادات', 'Settings')}
        lead={t(
          'بيانات منشأتك تظهر على الفواتير، ولغة المتجر تحدّد لغة زر العرض داخل صفحات منتجاتك.',
          'Your business details appear on invoices, and the store language sets the language of the AR button inside your product pages.',
        )}
      />

      {loading && <Panel><Loading rows={5} /></Panel>}

      {!loading && (
        <div className="grid grid-2">
          <Panel title={t('بيانات المنشأة', 'Business details')} sub={t('تُستخدم في الفواتير الضريبية', 'Used on tax invoices')}>
            <div className="field">
              <label htmlFor="store-name">{t('اسم المتجر', 'Store name')}</label>
              <input id="store-name" defaultValue={data?.tenant.name ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="cr">{t('رقم السجل التجاري', 'Commercial registration (CR)')}</label>
              <input id="cr" inputMode="numeric" value={crNumber} onChange={(e) => setCrNumber(e.target.value)}
                placeholder={t('1010xxxxxx', '1010xxxxxx')} />
              <span className="field-hint">
                {t('كما هو في وزارة التجارة.', 'As registered with the Ministry of Commerce.')}
              </span>
            </div>
            <div className="field">
              <label htmlFor="vat">{t('الرقم الضريبي', 'VAT number')}</label>
              <input id="vat" inputMode="numeric" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)}
                placeholder="3xxxxxxxxxxxxx3" />
              <span className="field-hint">
                {t('15 رقمًا يبدأ وينتهي بالرقم 3.', '15 digits, starting and ending with 3.')}
              </span>
            </div>
            <div className="field">
              <label htmlFor="address">{t('العنوان الوطني', 'National Address')}</label>
              <input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <button type="button" className="btn btn-primary"><Building2 size={16} aria-hidden />{t('حفظ', 'Save')}</button>
          </Panel>

          <div className="grid" style={{ gap: 18 }}>
            <Panel title={t('اللغة والمنطقة', 'Language and region')}>
              <div className="field">
                <label htmlFor="locale">{t('لغة لوحة التحكم', 'Dashboard language')}</label>
                <select id="locale" value={lang} onChange={(e) => setLang(e.target.value as 'ar' | 'en')}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                <Globe size={13} aria-hidden /> {t(
                  'المنطقة الزمنية: آسيا/الرياض · العملة: ريال سعودي · نهاية الأسبوع: الجمعة والسبت',
                  'Timezone: Asia/Riyadh · Currency: Saudi riyal · Weekend: Friday and Saturday',
                )}
              </p>
            </Panel>

            <Panel title={t('نص موافقة المتسوّق', 'Shopper consent text')}
              sub={t('يظهر قبل فتح الكاميرا للتجربة الافتراضية', 'Shown before the camera opens for virtual try-on')}>
              <div className="field">
                <label htmlFor="consent">{t('النص بالعربية', 'Arabic text')}</label>
                <input id="consent" defaultValue={t(
                  'صورة الكاميرا تبقى على جهازك ولا تُرسل إلى أي خادم.',
                  'Your camera image stays on your device and is never sent to a server.',
                )} />
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                <ShieldCheck size={13} aria-hidden /> {t(
                  'هذه الجملة صحيحة حرفيًا: معالجة التجربة الافتراضية تتم داخل متصفح المتسوّق، ولا تغادر الصور جهازه.',
                  'That sentence is literally true: try-on inference runs inside the shopper’s browser, and the frames never leave their device.',
                )}
              </p>
            </Panel>

            <Panel title={t('خصوصية البيانات', 'Data protection')}>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)' }}>
                {t(
                  'نلتزم بنظام حماية البيانات الشخصية السعودي (PDPL). يمكنك طلب تصدير بياناتك أو حذفها في أي وقت، ونستجيب خلال المدة النظامية.',
                  'We follow the Saudi Personal Data Protection Law (PDPL). You can request an export or an erasure of your data at any time, and we respond within the statutory period.',
                )}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost btn-sm">{t('تصدير بياناتي', 'Export my data')}</button>
                <button type="button" className="btn btn-quiet btn-sm">{t('طلب الحذف', 'Request erasure')}</button>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </Shell>
  );
}
