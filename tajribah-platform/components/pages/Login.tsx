'use client';

// AUTH-001 — Sign in

import { useEffect, useState, type FormEvent } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { LangToggle } from '@/components/dashboard/chrome';
import { useAuth } from '@/lib/auth';
import { safeNext } from '@/lib/safe-next';
import { authErrorMessage } from './auth-errors';

export default function Login() {
  const { t } = useLang();
  const env = useEnv();
  const auth = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const next = safeNext(new URLSearchParams(env.search).get('next'));

  // Already signed in (a restored session): go straight on.
  useEffect(() => {
    if (auth.live && auth.status === 'signed-in') env.navigate(next);
  }, [auth.live, auth.status, env, next]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth.live) {
      // Nothing is sent in the preview, and it says so rather than pretending to sign in.
      setNote(t('هذه معاينة ثابتة بدون خادم — لا يتم تسجيل دخول فعلي.', 'This is a static preview with no server — no real sign-in happens.'));
      return;
    }
    const form = new FormData(event.currentTarget);
    setPending(true);
    setNote(null);
    try {
      await auth.login(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
      env.navigate(next);
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
        <h2>{t('اجعل عميلك يرى المنتج بحجمه الحقيقي قبل أن يشتري.', 'Let your shopper see the real size before they buy.')}</h2>
        <ul>
          {[
            t('عرض ثلاثي الأبعاد داخل صفحة منتجك', '3D and AR inside your own product page'),
            t('تجربة افتراضية تعمل داخل متصفح العميل', 'Virtual try-on that runs in the shopper’s browser'),
            t('أرقام تقيس أثرها على التحويل والإرجاع', 'Numbers that measure the effect on conversion and returns'),
          ].map((line) => (
            <li key={line}><Check size={16} aria-hidden />{line}</li>
          ))}
        </ul>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}><LangToggle /></div>
          <h1>{t('تسجيل الدخول', 'Sign in')}</h1>
          <p>{t('أدخل بريدك وكلمة المرور للمتابعة.', 'Enter your email and password to continue.')}</p>

          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">{t('البريد الإلكتروني', 'Email')}</label>
              <input id="email" name="email" type="email" autoComplete="email" dir="ltr" required />
            </div>

            <div className="field">
              <label htmlFor="password">{t('كلمة المرور', 'Password')}</label>
              <div style={{ position: 'relative' }}>
                <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" dir="ltr" required />
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{ position: 'absolute', insetInlineEnd: 4, top: 4 }}
                  aria-label={showPassword ? t('إخفاء كلمة المرور', 'Hide password') : t('إظهار كلمة المرور', 'Show password')}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {note && <p className="field-hint" role="alert" style={{ color: 'var(--warn)', marginBottom: 12 }}>{note}</p>}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
              {pending ? t('جارٍ الدخول…', 'Signing in…') : t('دخول', 'Sign in')}
            </button>
          </form>

          <p style={{ marginTop: 16, fontSize: 14, color: 'var(--text-2)' }}>
            <AppLink href="/reset" style={{ color: 'var(--aqua)' }}>{t('نسيت كلمة المرور؟', 'Forgot your password?')}</AppLink>
          </p>
          <p style={{ marginTop: 4, fontSize: 14, color: 'var(--text-2)' }}>
            {t('ليس لديك حساب؟', 'No account yet?')}{' '}
            <AppLink href="/register" style={{ color: 'var(--aqua)' }}>{t('أنشئ متجرك', 'Create your store')}</AppLink>
          </p>
        </div>
      </main>
    </div>
  );
}
