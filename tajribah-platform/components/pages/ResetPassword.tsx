'use client';

// AUTH-16 — Forgot password: request · AUTH-17 — email sent
// AUTH-18 — Reset password: set new · AUTH-19 — password changed

import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, MailCheck } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { LangToggle } from '@/components/dashboard/chrome';
import { authErrorMessage } from './auth-errors';

/** The same rule as the API's `PASSWORD` (server/modules/auth/http.ts). */
const MIN_PASSWORD = 10;

export default function ResetPassword() {
  const env = useEnv();
  const token = new URLSearchParams(env.search).get('token');
  return (
    <div className="auth-wrap">
      <main className="auth-main" style={{ gridColumn: '1 / -1' }}>
        <div className="auth-card">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}><LangToggle /></div>
          {token ? <SetPassword token={token} /> : <RequestLink />}
        </div>
      </main>
    </div>
  );
}

function RequestLink() {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setNote(t('البريد الإلكتروني غير صالح.', 'That email address is not valid.'));
      return;
    }
    if (!auth.live) {
      setNote(t('هذه معاينة ثابتة بدون خادم — لا يُرسل بريد فعلي.', 'This is a static preview with no server — no email is sent.'));
      return;
    }
    setPending(true);
    setNote(null);
    try {
      await auth.requestPasswordReset(email, lang);
      setSentTo(email);
    } catch (error) {
      setNote(authErrorMessage(error, t));
    } finally {
      setPending(false);
    }
  };

  if (sentTo) {
    // AUTH-17. Worded for both cases: the server does not say whether the address has an account.
    return (
      <>
        <span className="empty-icon" style={{ margin: '0 0 12px' }}><MailCheck size={22} aria-hidden /></span>
        <h1>{t('تحقّق من بريدك', 'Check your inbox')}</h1>
        <p>
          {t('إن كان للعنوان', 'If')} <strong dir="ltr">{sentTo}</strong>{' '}
          {t(
            'حساب لدينا، فقد أرسلنا إليه رابطًا لتعيين كلمة مرور جديدة. الرابط صالح لمدة ساعة ويعمل مرة واحدة.',
            'has an account with us, we sent it a link to set a new password. The link is valid for one hour and works once.',
          )}
        </p>
        <p className="hint">{t('لم يصل؟ انظر في مجلد الرسائل غير المرغوب فيها، أو اطلب رابطًا آخر.', 'Nothing arrived? Look in your spam folder, or ask for another link.')}</p>
        <button type="button" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => setSentTo(null)}>
          {t('اطلب رابطًا آخر', 'Ask for another link')}
        </button>
        <BackToSignIn />
      </>
    );
  }

  return (
    <>
      <h1>{t('نسيت كلمة المرور؟', 'Forgot your password?')}</h1>
      <p>{t('أدخل بريدك ونرسل إليك رابطًا لتعيين كلمة مرور جديدة.', 'Enter your email and we send you a link to set a new password.')}</p>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">{t('البريد الإلكتروني', 'Email')}</label>
          <input id="email" name="email" type="email" autoComplete="email" dir="ltr" required />
        </div>
        {note && <p className="field-hint" role="alert" style={{ color: 'var(--warn)', marginBottom: 12 }}>{note}</p>}
        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
          {pending ? t('جارٍ الإرسال…', 'Sending…') : t('أرسل الرابط', 'Send the link')}
        </button>
      </form>
      <BackToSignIn />
    </>
  );
}

function SetPassword({ token }: { token: string }) {
  const { t } = useLang();
  const auth = useAuth();
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    if (password.length < MIN_PASSWORD) {
      setNote(t('كلمة المرور يجب أن تكون 10 أحرف على الأقل.', 'The password must be at least 10 characters.'));
      return;
    }
    if (!auth.live) {
      setNote(t('هذه معاينة ثابتة بدون خادم — لا تتغير كلمة مرور فعلية.', 'This is a static preview with no server — no password is changed.'));
      return;
    }
    setPending(true);
    setNote(null);
    try {
      await auth.resetPassword(token, password);
      setDone(true);
    } catch (error) {
      // 422 on `token`: expired, used or wrong — the server gives one answer for all three.
      if (error instanceof ApiError && error.status === 422 && error.fields?.token) setExpired(true);
      else setNote(authErrorMessage(error, t));
    } finally {
      setPending(false);
    }
  };

  if (done) {
    // AUTH-19
    return (
      <>
        <span className="empty-icon" style={{ margin: '0 0 12px', color: 'var(--ok)' }}><KeyRound size={22} aria-hidden /></span>
        <h1>{t('تم تغيير كلمة المرور', 'Your password is changed')}</h1>
        <p>{t(
          'أنهينا كل جلسة مفتوحة على حسابك، في كل جهاز، احتياطًا. سجّل الدخول بكلمة المرور الجديدة.',
          'As a precaution we ended every open session on your account, on every device. Sign in with the new password.',
        )}</p>
        <AppLink href="/login" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>{t('سجّل الدخول', 'Sign in')}</AppLink>
      </>
    );
  }

  if (expired) {
    return (
      <>
        <h1>{t('هذا الرابط لم يعد صالحًا', 'This link no longer works')}</h1>
        <p>{t('روابط إعادة التعيين تعمل مرة واحدة ولمدة ساعة. اطلب رابطًا جديدًا.', 'Reset links work once and for one hour. Ask for a new one.')}</p>
        <AppLink href="/reset-password" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>{t('اطلب رابطًا جديدًا', 'Ask for a new link')}</AppLink>
        <BackToSignIn />
      </>
    );
  }

  return (
    <>
      <h1>{t('كلمة مرور جديدة', 'Set a new password')}</h1>
      <p>{t('بعد الحفظ نُنهي كل الجلسات المفتوحة على حسابك.', 'Saving it ends every open session on your account.')}</p>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="password">{t('كلمة المرور الجديدة', 'New password')}</label>
          <div style={{ position: 'relative' }} dir="ltr">
            <input id="password" name="password" type={show ? 'text' : 'password'} autoComplete="new-password" dir="ltr" minLength={MIN_PASSWORD} required aria-describedby="password-hint" style={{ paddingInlineEnd: 44 }} />
            <button
              type="button" className="btn btn-quiet btn-sm" onClick={() => setShow((v) => !v)}
              style={{ position: 'absolute', insetInlineEnd: 4, top: 4 }}
              aria-label={show ? t('إخفاء كلمة المرور', 'Hide password') : t('إظهار كلمة المرور', 'Show password')}
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <span id="password-hint" className="field-hint">{t('10 أحرف على الأقل.', 'At least 10 characters.')}</span>
        </div>
        {note && <p className="field-hint" role="alert" style={{ color: 'var(--warn)', marginBottom: 12 }}>{note}</p>}
        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
          {pending ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ كلمة المرور', 'Save the password')}
        </button>
      </form>
    </>
  );
}

function BackToSignIn() {
  const { t } = useLang();
  return (
    <p style={{ marginTop: 16, fontSize: 14, color: 'var(--text-2)' }}>
      <AppLink href="/login" style={{ color: 'var(--aqua)' }}>{t('العودة لتسجيل الدخول', 'Back to sign in')}</AppLink>
    </p>
  );
}
