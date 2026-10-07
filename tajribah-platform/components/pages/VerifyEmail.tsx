'use client';

// AUTH-06 — Email verification: success · AUTH-07 — link expired / resend

import { useEffect, useState } from 'react';
import { MailCheck, MailWarning } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useAuth, type AuthApi } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { AuthTop } from './AuthTop';
import { authErrorMessage } from './auth-errors';

type Outcome = 'checking' | 'verified' | 'refused' | 'preview';

/**
 * A link works once, so it is sent once per page load: React runs effects twice in
 * development, and a second POST would turn a good link into "expired" on screen.
 */
const attempts = new Map<string, Promise<boolean>>();
function verifyOnce(auth: AuthApi, token: string): Promise<boolean> {
  let attempt = attempts.get(token);
  if (!attempt) {
    attempt = auth.verifyEmail(token).then(() => true, () => false);
    attempts.set(token, attempt);
  }
  return attempt;
}

export default function VerifyEmail() {
  const { t } = useLang();
  const env = useEnv();
  const auth = useAuth();
  const token = new URLSearchParams(env.search).get('token') ?? '';
  const [result, setResult] = useState<{ token: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!auth.live || !token) return;
    let live = true;
    void verifyOnce(auth, token).then((ok) => { if (live) setResult({ token, ok }); });
    return () => { live = false; };
  }, [auth, token]);

  const outcome: Outcome = !auth.live ? 'preview'
    : !token ? 'refused'
      : result?.token === token ? (result.ok ? 'verified' : 'refused')
        : 'checking';

  return (
    <div className="auth-wrap">
      <main className="auth-main" style={{ gridColumn: '1 / -1' }}>
        <div className="auth-card">
          <AuthTop />

          {outcome === 'checking' && (
            <>
              <h1>{t('نتحقق من الرابط…', 'Checking your link…')}</h1>
              <p>{t('لحظة واحدة.', 'One moment.')}</p>
            </>
          )}

          {outcome === 'verified' && (
            <>
              <span className="empty-icon" style={{ margin: '0 0 12px', color: 'var(--ok)' }}><MailCheck size={22} aria-hidden /></span>
              <h1>{t('تم تأكيد بريدك الإلكتروني', 'Your email is confirmed')}</h1>
              <p>{t('شكرًا. نرسل إليه الفواتير وتنبيهات متجرك.', 'Thank you. Invoices and store alerts go to this address.')}</p>
              <AppLink
                href={auth.status === 'signed-in' ? '/dashboard/onboarding' : '/login?next=%2Fdashboard%2Fonboarding'}
                className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
              >
                {auth.status === 'signed-in' ? t('أكمل إعداد متجرك', 'Continue setting up your store') : t('سجّل الدخول', 'Sign in')}
              </AppLink>
            </>
          )}

          {outcome === 'refused' && <Refused />}

          {outcome === 'preview' && (
            <>
              <h1>{t('تأكيد البريد الإلكتروني', 'Confirm your email')}</h1>
              <p>{t('هذه معاينة ثابتة بدون خادم — الرابط يُتحقق منه في التطبيق الحقيقي.', 'This is a static preview with no server — the link is checked in the real app.')}</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/** AUTH-07: the link is expired, used or wrong — the three are one answer, as on the server. */
function Refused() {
  const { t } = useLang();
  const auth = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'verified'>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  const resend = async () => {
    setState('sending');
    setProblem(null);
    try {
      const result = await auth.resendVerification();
      setState(result.alreadyVerified ? 'verified' : 'sent');
    } catch (error) {
      setProblem(authErrorMessage(error, t));
      setState('idle');
    }
  };

  return (
    <>
      <span className="empty-icon" style={{ margin: '0 0 12px', color: 'var(--warn)' }}><MailWarning size={22} aria-hidden /></span>
      <h1>{t('هذا الرابط لم يعد صالحًا', 'This link no longer works')}</h1>
      <p>{t(
        'روابط التأكيد تعمل مرة واحدة ولمدة 24 ساعة، وكل رابط جديد يُبطل ما قبله.',
        'Confirmation links work once and for 24 hours, and each new link replaces the one before.',
      )}</p>

      {auth.status === 'signed-in' && state === 'sent' && (
        <p role="status" style={{ color: 'var(--ok)' }}>
          {t('أرسلنا رابطًا جديدًا إلى', 'We sent a new link to')} <strong dir="ltr">{auth.me?.user.email}</strong>.
        </p>
      )}
      {auth.status === 'signed-in' && state === 'verified' && (
        <p role="status" style={{ color: 'var(--ok)' }}>{t('بريدك مؤكَّد مسبقًا — لا حاجة لرابط جديد.', 'Your email is already confirmed — no new link needed.')}</p>
      )}
      {problem && <p className="field-hint" role="alert" style={{ color: 'var(--warn)', marginBottom: 12 }}>{problem}</p>}

      {auth.status === 'signed-in' && (state === 'idle' || state === 'sending') && (
        <button type="button" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={resend} disabled={state === 'sending'}>
          {state === 'sending' ? t('جارٍ الإرسال…', 'Sending…') : t('أرسل رابطًا جديدًا', 'Send a new link')}
        </button>
      )}
      {auth.status === 'signed-out' && (
        <AppLink href="/login?next=%2Fdashboard%2Fonboarding" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
          {t('سجّل الدخول لإرسال رابط جديد', 'Sign in to get a new link')}
        </AppLink>
      )}
      {(state === 'sent' || state === 'verified') && (
        <AppLink href="/dashboard/onboarding" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>
          {t('إلى إعداد المتجر', 'Go to store setup')}
        </AppLink>
      )}
    </>
  );
}
