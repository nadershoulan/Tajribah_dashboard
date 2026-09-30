'use client';

// AUTH-015 — Sign in with the store's single sign-on (P8)

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Building2 } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useAuth } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { LangToggle } from '@/components/dashboard/chrome';
import { authErrorMessage } from './auth-errors';

/**
 * From the store's own sign-in address (`/login/sso?store=bigco`) to its provider, and back here with
 * `code` and `state` — handed to the server once (it checks them against this browser's flow), then
 * taken out of the address.
 */
export default function LoginSso() {
  const { t } = useLang();
  const env = useEnv();
  const auth = useAuth();
  const query = new URLSearchParams(env.search);
  // Read once, as the page opens: the address is cleaned right after.
  const [returning] = useState(() => (query.get('code') && query.get('state') ? { code: query.get('code')!, state: query.get('state')! } : null));
  const denied = query.get('error');
  const preview = t('هذه معاينة ثابتة بدون خادم — لا يتم تسجيل دخول فعلي.', 'This is a static preview with no server — no real sign-in happens.');
  const [store, setStore] = useState(query.get('store') ?? '');
  const [busy, setBusy] = useState(!!returning);
  const [note, setNote] = useState<string | null>(denied
    ? t('لم يكتمل الدخول عند مزوّد شركتك. حاول مرة أخرى.', 'Sign-in was not completed at your company’s provider. Try again.') : null);
  const started = useRef(false);

  useEffect(() => {
    if (!returning || started.current) return;
    started.current = true;
    if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname); // the code works once; never leave it in the address
    auth.completeSso(returning.code, returning.state).then(
      () => env.navigate('/dashboard'),
      (error) => { setBusy(false); setNote(auth.live ? authErrorMessage(error, t) : preview); },
    );
  }, [returning, auth, env, t, preview]);

  const go = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth.live) { setNote(preview); return; }
    setBusy(true); setNote(null);
    try {
      window.location.assign(await auth.startSso(store.trim()));
    } catch (error) {
      setNote(authErrorMessage(error, t));
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <main className="auth-main" style={{ gridColumn: '1 / -1' }}>
        <div className="auth-card">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}><LangToggle /></div>
          <span className="empty-icon" style={{ margin: '0 0 12px' }}><Building2 size={22} aria-hidden /></span>
          <h1>{t('الدخول بحساب شركتك', 'Sign in with your company account')}</h1>
          {returning && busy ? (
            <p role="status">{t('نتحقق من دخولك…', 'Checking your sign-in…')}</p>
          ) : (
            <>
              <p>{t('إذا كان متجرك يستخدم تسجيل الدخول الموحّد، أدخل عنوان متجرك في تجربة.', 'If your store uses single sign-on, enter your store’s address on Tajribah.')}</p>
              <form onSubmit={go} noValidate>
                <div className="field">
                  <label htmlFor="store">{t('عنوان متجرك', 'Your store’s address')}</label>
                  <div dir="ltr" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="hint" style={{ margin: 0 }}>app.tajribah.sa/</span>
                    <input id="store" name="store" dir="ltr" value={store} onChange={(e) => setStore(e.target.value)} placeholder="your-store" autoComplete="organization" maxLength={120} style={{ flex: 1, minWidth: 0 }} />
                  </div>
                </div>
                {note && <p className="field-hint" role="alert" style={{ color: 'var(--warn)', marginBottom: 12 }}>{note}</p>}
                <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || !store.trim()}>
                  {busy ? t('جارٍ التحويل…', 'Opening…') : t('تابع إلى مزوّد شركتك', 'Continue to your company’s sign-in')}
                </button>
              </form>
            </>
          )}
          {note && returning && <p className="field-hint" role="alert" style={{ color: 'var(--warn)' }}>{note}</p>}
          <p style={{ marginTop: 16, fontSize: 14 }}>
            <AppLink href="/login" style={{ color: 'var(--aqua-ink)' }}>{t('الدخول بالبريد وكلمة المرور', 'Sign in with email and password')}</AppLink>
          </p>
        </div>
      </main>
    </div>
  );
}
