'use client';

import { useState, type FormEvent } from 'react';
import { Mail, Send } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { SiteLink } from '@/lib/site-env';
import { COMPANY } from '@/lib/site';
import { Shell } from '@/components/site/chrome';
import { PageHero } from '@/components/site/ui';

/**
 * No backend is wired for enquiries yet, so the form composes an email in the
 * visitor's mail app — and says so. It never pretends a message was sent.
 */
export default function Contact() {
  const { t } = useLang();
  const [opened, setOpened] = useState(false);

  const platforms = [
    ['salla', t('سلة', 'Salla')], ['zid', t('زد', 'Zid')], ['shopify', 'Shopify'],
    ['woocommerce', 'WooCommerce'], ['custom', t('متجر مخصص', 'Custom store')], ['other', t('أخرى', 'Other')],
  ] as const;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? '').trim();
    const platform = platforms.find(([id]) => id === get('platform'))?.[1] ?? '';
    const subject = t(`طلب عرض لمتجر ${get('store') || get('name')}`, `Store demo request — ${get('store') || get('name')}`);
    const body = [
      `${t('الاسم', 'Name')}: ${get('name')}`,
      `${t('البريد', 'Email')}: ${get('email')}`,
      `${t('الجوال', 'Phone')}: ${get('phone')}`,
      `${t('رابط المتجر', 'Store URL')}: ${get('store')}`,
      `${t('المنصة', 'Platform')}: ${platform}`,
      '',
      get('message'),
    ].join('\n');
    window.location.href = `mailto:${COMPANY.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setOpened(true);
  }

  return (
    <Shell current="/contact">
      <PageHero eyebrow={t('تواصل معنا', 'Contact')}
        title={t('لنجرّبها على منتجاتك', 'Let’s try it on your products')}
        lead={t('أخبرنا عن متجرك، وسنجهّز عرضًا على منتج منه لتراه في صفحة منتج حقيقية.',
          'Tell us about your store and we will set up a demo on one of its products, on a real product page.')} />

      <section className="sec">
        <div className="wrap contact-grid">
          <form className="form" onSubmit={submit}>
            <div className="field-row">
              <label className="field"><span>{t('الاسم', 'Name')}</span><input id="c-name" name="name" required autoComplete="name" /></label>
              <label className="field"><span>{t('البريد الإلكتروني', 'Email')}</span><input id="c-email" name="email" type="email" required autoComplete="email" dir="ltr" /></label>
            </div>
            <div className="field-row">
              <label className="field"><span>{t('رقم الجوال (اختياري)', 'Phone (optional)')}</span><input id="c-phone" name="phone" type="tel" autoComplete="tel" dir="ltr" placeholder="05xxxxxxxx" /></label>
              <label className="field"><span>{t('رابط المتجر', 'Store URL')}</span><input id="c-store" name="store" type="url" dir="ltr" placeholder="https://" /></label>
            </div>
            <label className="field"><span>{t('منصة المتجر', 'Store platform')}</span>
              <select id="c-platform" name="platform" defaultValue="salla">
                {platforms.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="field"><span>{t('ماذا تبيع، وماذا تريد أن يجرّب عملاؤك؟', 'What do you sell, and what should shoppers try?')}</span>
              <textarea id="c-message" name="message" rows={5} />
            </label>
            <button className="btn btn-primary" type="submit"><Send size={17} aria-hidden />{t('جهّز الرسالة', 'Prepare the email')}</button>
            <p className="fine">
              {opened
                ? t('فُتح تطبيق البريد لديك وفيه رسالتك جاهزة. اضغط «إرسال» هناك لتصلنا.', 'Your mail app opened with the message ready. Press send there to reach us.')
                : t('سيفتح تطبيق البريد لديك ورسالتك جاهزة للإرسال. باستخدامك النموذج توافق على', 'Your mail app will open with the message ready to send. By using this form you agree to our')}
              {!opened && <> <SiteLink href="/privacy">{t('سياسة الخصوصية', 'privacy policy')}</SiteLink>.</>}
            </p>
          </form>

          <aside className="contact-side">
            <div className="panel-card">
              <Mail size={22} aria-hidden className="q-icon" />
              <h3>{t('راسلنا مباشرة', 'Email us directly')}</h3>
              <a href={`mailto:${COMPANY.email}`} dir="ltr" className="mail-big">{COMPANY.email}</a>
              <p>{t('أو اتصل بنا:', 'Or call us:')} <a href={`tel:${COMPANY.tel}`} dir="ltr">{COMPANY.phone}</a></p>
              <p className="fine">{t('لطلبات الخصوصية والبيانات الشخصية:', 'For privacy and personal-data requests:')} <a href={`mailto:${COMPANY.privacyEmail}`} dir="ltr">{COMPANY.privacyEmail}</a></p>
            </div>
            <div className="panel-card">
              <h3>{t('قبل أن تراسلنا', 'Before you write')}</h3>
              <p>{t('جرّب العرض التجريبي لترى الطرق الثلاث، واطّلع على الأسعار لتعرف الباقة الأقرب لمتجرك.', 'Try the live demo to see all three modes, and check pricing to find the plan closest to your store.')}</p>
              <div className="row-links">
                <SiteLink href="/demo" className="link-more">{t('العرض التجريبي', 'Live demo')}</SiteLink>
                <SiteLink href="/pricing" className="link-more">{t('الأسعار', 'Pricing')}</SiteLink>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </Shell>
  );
}
