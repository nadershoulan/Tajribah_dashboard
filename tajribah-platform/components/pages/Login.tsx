'use client';

// AUTH-001 — Sign in · AUTH-12 — two-step code · AUTH-14 — backup code

import { useEffect, useState, type FormEvent } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { AppLink, useEnv } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { AuthTop } from './AuthTop';
import { useAuth } from '@/lib/auth';
import { safeNext } from '@/lib/safe-next';
import { authErrorMessage } from './auth-errors';
import { PasswordInput } from '@/components/dashboard/password-input';

export default function Login() {
  const { t } = useLang();
  const env = useEnv();
  const auth = useAuth();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // P1.2b: set once the password was right and a code is still needed.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [useBackup, setUseBackup] = useState(false);
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
      const pending = await auth.login(String(form.get('email') ?? ''), String(form.get('password') ?? ''));
      if (pending) { setChallenge(pending.twoFactorChallenge); return; }
      env.navigate(next);
    } catch (error) {
      setNote(authErrorMessage(error, t));
    } finally {
      setPending(false);
    }
  };

  const onCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!challenge) return;
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    if (!code) return;
    setPending(true);
    setNote(null);
    try {
      await auth.completeTwoFactor(challenge, code);
      env.navigate(next);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'unauthenticated') {
        // The five minutes ran out, or the password changed meanwhile: back to the first step.
        setChallenge(null);
        setNote(t('انتهت مهلة هذه الخطوة. أدخل كلمة المرور مرة أخرى.', 'That step timed out. Enter your password again.'));
      } else if (error instanceof ApiError && error.code === 'invalid_credentials') {
        setNote(useBackup
          ? t('رمز الاستعداد غير صحيح أو استُخدم من قبل.', 'That backup code is not right, or it was already used.')
          : t('الرمز غير صحيح. أدخل الرمز الظاهر الآن في تطبيق المصادقة.', 'That code is not right. Enter the code your authenticator app shows now.'));
      } else {
        setNote(authErrorMessage(error, t));
      }
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
          <AuthTop />
          {challenge ? (
            <>
              <span className="empty-icon" style={{ margin: '0 0 12px' }}><ShieldCheck size={22} aria-hidden /></span>
              <h1>{t('التحقق بخطوتين', 'Two-step sign-in')}</h1>
              <p>{useBackup
                ? t('أدخل أحد رموز الاستعداد التي حفظتها. كل رمز يعمل مرة واحدة.', 'Enter one of the backup codes you saved. Each code works once.')
                : t('أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.', 'Enter the 6-digit code from your authenticator app.')}</p>
              <form onSubmit={onCode} noValidate key={useBackup ? 'backup' : 'code'}>
                <div className="field">
                  <label htmlFor="code">{useBackup ? t('رمز الاستعداد', 'Backup code') : t('رمز التحقق', 'Verification code')}</label>
                  <input
                    id="code" name="code" dir="ltr" required autoFocus
                    {...(useBackup
                      ? { autoComplete: 'off', placeholder: 'xxxx-xxxx', maxLength: 20 }
                      : { autoComplete: 'one-time-code', inputMode: 'numeric' as const, placeholder: '123456', maxLength: 8 })}
                  />
                </div>
                {note && <p className="field-hint" role="alert" style={{ color: 'var(--warn)', marginBottom: 12 }}>{note}</p>}
                <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
                  {pending ? t('جارٍ التحقق…', 'Checking…') : t('تحقّق', 'Verify')}
                </button>
              </form>
              <p style={{ marginTop: 16, fontSize: 14 }}>
                <button type="button" className="linklike" style={{ color: 'var(--aqua-ink)', display: 'inline' }} onClick={() => { setUseBackup((v) => !v); setNote(null); }}>
                  {useBackup ? t('استخدم تطبيق المصادقة', 'Use the authenticator app') : t('لا يمكنك استخدام التطبيق؟ استخدم رمز استعداد', 'Can’t use the app? Use a backup code')}
                </button>
              </p>
            </>
          ) : (
          <>
          <h1>{t('تسجيل الدخول', 'Sign in')}</h1>
          <p>{t('أدخل بريدك وكلمة المرور للمتابعة.', 'Enter your email and password to continue.')}</p>

          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">{t('البريد الإلكتروني', 'Email')}</label>
              <input id="email" name="email" type="email" autoComplete="email" dir="ltr" required />
            </div>

            <div className="field">
              <label htmlFor="password">{t('كلمة المرور', 'Password')}</label>
              <PasswordInput id="password" name="password" autoComplete="current-password" required />
            </div>

            {note && <p className="field-hint" role="alert" style={{ color: 'var(--warn)', marginBottom: 12 }}>{note}</p>}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
              {pending ? t('جارٍ الدخول…', 'Signing in…') : t('دخول', 'Sign in')}
            </button>
          </form>

          <p style={{ marginTop: 16, fontSize: 14, color: 'var(--text-2)' }}>
            <AppLink href="/login/sso" style={{ color: 'var(--aqua-ink)' }}>{t('الدخول بحساب شركتك (SSO)', 'Sign in with your company account (SSO)')}</AppLink>
          </p>
          <p style={{ marginTop: 4, fontSize: 14, color: 'var(--text-2)' }}>
            <AppLink href="/reset-password" style={{ color: 'var(--aqua-ink)' }}>{t('نسيت كلمة المرور؟', 'Forgot your password?')}</AppLink>
          </p>
          <p style={{ marginTop: 4, fontSize: 14, color: 'var(--text-2)' }}>
            {t('ليس لديك حساب؟', 'No account yet?')}{' '}
            <AppLink href="/register" style={{ color: 'var(--aqua-ink)' }}>{t('أنشئ متجرك', 'Create your store')}</AppLink>
          </p>
          </>
          )}
        </div>
      </main>
    </div>
  );
}
