'use client';

// AUTH-002 — Create an account

import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { LangToggle } from '@/components/dashboard/chrome';
import { useAuth } from '@/lib/auth';
import { authErrorMessage } from './auth-errors';
import { slugify } from '@/lib/slug';
import { TRIAL_DAYS } from '@/lib/plans';

export default function Register() {
  const { t, lang } = useLang();
  const env = useEnv();
  const auth = useAuth();
  const [storeName, setStoreName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const slug = slugify(storeName);
  // §13.6: never derive a slug from an Arabic name without showing the merchant the result.
  const needsConfirmation = storeName.trim().length > 2 && slug === null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth.live) {
      setNote(t('هذه معاينة ثابتة بدون خادم — لا يُنشأ حساب فعلي.', 'This is a static preview with no server — no account is created.'));
      return;
    }
    const form = new FormData(event.currentTarget);
    const phone = String(form.get('phone') ?? '').trim();
    setPending(true);
    setNote(null);
    try {
      await auth.register({
        fullName: String(form.get('fullName') ?? ''),
        storeName,
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        locale: lang,
        ...(phone ? { phone } : {}),
      });
      env.navigate('/dashboard');
    } catch (error) {
      setNote(authErrorMessage(error, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-wrap">
      <aside className="auth-side">
        <img src={env.asset('/brand/tajribah-wordmark-light.png')} alt="Tajribah تجربة" />
        <h2>{t(`ابدأ بتجربة مجانية ${TRIAL_DAYS} يومًا.`, `Start with a ${TRIAL_DAYS}-day free trial.`)}</h2>
        <ul>
          {[
            t('بدون بطاقة بنكية', 'No card required'),
            t('اربط سلة أو زد واستورد منتجاتك في دقائق', 'Connect Salla or Zid and import your catalogue in minutes'),
            t('ألغِ في أي وقت', 'Cancel any time'),
          ].map((line) => (
            <li key={line}><Check size={16} aria-hidden />{line}</li>
          ))}
        </ul>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}><LangToggle /></div>
          <h1>{t('أنشئ متجرك على تجربة', 'Create your store on Tajribah')}</h1>
          <p>{t('دقيقتان، ثم نربط متجرك.', 'Two minutes, then we connect your store.')}</p>

          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="fullName">{t('اسمك', 'Your name')}</label>
              <input id="fullName" name="fullName" autoComplete="name" required />
            </div>

            <div className="field">
              <label htmlFor="storeName">{t('اسم المتجر', 'Store name')}</label>
              <input id="storeName" value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
              {slug && (
                <span className="field-hint" dir="ltr">
                  tajribah.sa/{slug}
                </span>
              )}
              {needsConfirmation && (
                <span className="field-hint" style={{ color: 'var(--warn)' }}>
                  {t(
                    'سنقترح عليك رابطًا إنجليزيًا بعد التسجيل — لن نحوّل الاسم العربي تلقائيًا دون أن تراه.',
                    'We will suggest a Latin URL after signup — we will not transliterate your Arabic name without showing you first.',
                  )}
                </span>
              )}
            </div>

            <div className="field">
              <label htmlFor="email">{t('البريد الإلكتروني', 'Email')}</label>
              <input id="email" name="email" type="email" autoComplete="email" dir="ltr" required />
            </div>

            <div className="field">
              <label htmlFor="phone">{t('رقم الجوال', 'Mobile number')}</label>
              <input id="phone" name="phone" type="tel" autoComplete="tel" dir="ltr" placeholder="05X XXX XXXX" />
              <span className="field-hint">{t('لتأكيد الحساب برسالة نصية.', 'To confirm your account by SMS.')}</span>
            </div>

            <div className="field">
              <label htmlFor="password">{t('كلمة المرور', 'Password')}</label>
              <input id="password" name="password" type="password" autoComplete="new-password" dir="ltr" minLength={10} required />
              <span className="field-hint">{t('10 أحرف على الأقل.', 'At least 10 characters.')}</span>
            </div>

            {note && <p className="field-hint" role="alert" style={{ color: 'var(--warn)', marginBottom: 12 }}>{note}</p>}

            <button type="submit" className="btn btn-accent" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
              {pending ? t('جارٍ إنشاء المتجر…', 'Creating your store…') : t('ابدأ التجربة', 'Start the trial')}
            </button>
          </form>

          <p className="hint" style={{ marginTop: 12 }}>
            {t(
              'بإنشاء الحساب فإنك توافق على شروط الاستخدام وسياسة الخصوصية.',
              'By creating an account you agree to the terms of use and the privacy policy.',
            )}
          </p>
          <p style={{ marginTop: 10, fontSize: 14, color: 'var(--text-2)' }}>
            {t('لديك حساب؟', 'Already have an account?')}{' '}
            <AppLink href="/login" style={{ color: 'var(--aqua)' }}>{t('سجّل الدخول', 'Sign in')}</AppLink>
          </p>
        </div>
      </main>
    </div>
  );
}
