'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, Mail, Send } from 'lucide-react';
import { useLang } from '@site/lib/i18n';
import { SiteLink } from '@site/lib/site-env';
import { COMPANY } from '@site/lib/site';
import { Shell } from '@site/components/site/chrome';
import { PageHero } from '@site/components/site/ui';
import { Turnstile } from '@site/components/site/turnstile';

/**
 * T115 — the form sends to Tajribah's own inbox (`POST /api/contact` → `contact_messages`), read by staff in the
 * admin console. Behind it: Cloudflare Turnstile (checked on the server), a hidden trap field bots fill, and a
 * rate limit. It says "sent" only when the server kept the message.
 */
type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

export default function Contact({ turnstileSiteKey = null }: { turnstileSiteKey?: string | null }) {
  const { t, lang } = useLang();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [token, setToken] = useState<string | null>(null);
  const [resets, setResets] = useState(0);

  const platforms = [
    ['salla', t('سلة', 'Salla')], ['zid', t('زد', 'Zid')], ['shopify', 'Shopify'],
    ['woocommerce', 'WooCommerce'], ['custom', t('متجر مخصص', 'Custom store')], ['other', t('أخرى', 'Other')],
  ] as const;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (turnstileSiteKey && !token) { setState({ kind: 'error', message: t('أكمل التحقق أعلى زر الإرسال أولًا.', 'Complete the check above the send button first.') }); return; }
    const form = e.currentTarget;
    const f = new FormData(form);
    const get = (k: string) => String(f.get(k) ?? '').trim();
    setState({ kind: 'sending' });
    try {
      const response = await fetch('/api/contact', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: get('name'), email: get('email'), phone: get('phone') || undefined, store: get('store') || undefined, platform: get('platform') || undefined, message: get('message'), website: get('website'), token: token ?? undefined, lang }),
      });
      if (response.ok) { form.reset(); setState({ kind: 'sent' }); setResets((n) => n + 1); return; }
      const problem = await response.json().catch(() => null) as { status?: number; errors?: Record<string, string[]> } | null;
      setResets((n) => n + 1);
      if (response.status === 429) setState({ kind: 'error', message: t('أرسلت عدة رسائل خلال وقت قصير. حاول بعد قليل، أو راسلنا مباشرة.', 'You sent several messages in a short time. Try again later, or email us directly.') });
      else if (problem?.errors?.token) setState({ kind: 'error', message: t('لم يكتمل التحقق. أعد المحاولة.', 'The check did not complete. Please try again.') });
      else if (problem?.errors) setState({ kind: 'error', message: t('راجع الحقول: ', 'Check these fields: ') + Object.keys(problem.errors).map((k) => ({ name: t('الاسم', 'name'), email: t('البريد', 'email'), phone: t('الجوال', 'phone'), store: t('رابط المتجر', 'store URL'), message: t('الرسالة', 'message') } as Record<string, string>)[k] ?? k).join('، ') });
      else setState({ kind: 'error', message: t('تعذّر الإرسال الآن. حاول مرة أخرى، أو راسلنا مباشرة.', 'It could not be sent right now. Try again, or email us directly.') });
    } catch {
      setState({ kind: 'error', message: t('تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.', 'Could not connect. Check your connection and try again.') });
    }
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
              <textarea id="c-message" name="message" rows={5} maxLength={4000} />
            </label>
            {/* The trap: clipped to nothing (never moved off-screen — on a right-to-left page that made the page 10,000px
                wide), skipped by keyboards and password managers; a bot fills it, a person never sees it. */}
            <div aria-hidden="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap', opacity: 0, pointerEvents: 'none' }}>
              <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
            </div>
            {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} lang={lang} onToken={setToken} resetKey={resets} />}
            <button className="btn btn-primary" type="submit" disabled={state.kind === 'sending'}>
              <Send size={17} aria-hidden />{state.kind === 'sending' ? t('جارٍ الإرسال…', 'Sending…') : t('أرسل الرسالة', 'Send the message')}
            </button>
            {state.kind === 'sent' && <p role="status" className="fine"><CheckCircle2 size={16} aria-hidden /> {t('وصلتنا رسالتك، شكرًا لك. سنتواصل معك قريبًا على بريدك.', 'Your message reached us, thank you. We will get back to you by email soon.')}</p>}
            {state.kind === 'error' && <p role="alert" className="fine" style={{ color: 'var(--danger, #b42318)' }}>{state.message}</p>}
            <p className="fine">
              {t('باستخدامك النموذج توافق على', 'By using this form you agree to our')} <SiteLink href="/privacy">{t('سياسة الخصوصية', 'privacy policy')}</SiteLink>.
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
