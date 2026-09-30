'use client';

// T61 — the Tajribah app page inside the Salla merchant dashboard (`/salla/app`, API-068)

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { useData } from '@/lib/data';
import { useEnv } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import type { SallaAppView } from '@/lib/view-models';

type Embedded = typeof import('@/lib/vendor/salla-embedded-sdk-0.2.6/index.js')['embedded'];

type State =
  | { kind: 'checking' }
  | { kind: 'outside' }
  | { kind: 'problem'; code: string }
  | { kind: 'ready'; view: SallaAppView };

/**
 * Salla loads this page in a frame with a short-lived session token (`?token=…&lang=…`). The page
 * hands it to the server, which asks Salla which store it is, and answers with where linking stands.
 * Linking itself happens in Tajribah, signed in, at the top level — Salla takes the merchant there
 * (`page.redirect`) with a ten-minute ticket; no Tajribah password is ever typed inside Salla's page.
 *
 * Salla's SDK (vendored, `lib/vendor/`) is loaded only here: it tells Salla the page is ready — Salla
 * shows a loading screen until then — and only accepts messages from Salla's own addresses.
 */
export default function SallaApp() {
  const { t, lang, setLang } = useLang();
  const env = useEnv();
  const source = useData();
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const sdk = useRef<Embedded | null>(null);
  const query = new URLSearchParams(env.search);
  const token = query.get('token');
  const wanted = query.get('lang');

  useEffect(() => { if ((wanted === 'ar' || wanted === 'en') && wanted !== lang) setLang(wanted); }, [wanted, lang, setLang]);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!sdk.current && typeof window !== 'undefined' && window.parent !== window) {
        try {
          const { embedded } = await import('@/lib/vendor/salla-embedded-sdk-0.2.6/index.js');
          await embedded.init();
          sdk.current = embedded;
        } catch { /* not inside Salla's dashboard: the page still says what to do */ }
      }
      if (!token) { if (live) setState({ kind: 'outside' }); return; }
      try {
        const view = await source.openSallaApp(token);
        if (live) setState({ kind: 'ready', view });
      } catch (error) {
        if (live) setState({ kind: 'problem', code: (error as { code?: string }).code ?? '' });
      } finally {
        sdk.current?.ready();
      }
    })();
    return () => { live = false; };
  }, [token, source, attempt]);

  // Inside Salla, Salla itself takes the merchant to Tajribah (its frame may not open windows).
  const open = (path: string) => {
    const url = new URL(path, window.location.origin).toString();
    if (sdk.current) sdk.current.page.redirect(url); else window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="auth-wrap">
      <main className="auth-main" style={{ gridColumn: '1 / -1' }}>
      <div className="auth-card" aria-live="polite">
        <h1 style={{ marginBottom: 8 }}>{t('تجربة في متجرك على سلة', 'Tajribah in your Salla store')}</h1>
        {state.kind === 'checking' && <p role="status">{t('نتحقق من متجرك لدى سلة…', 'Checking your store with Salla…')}</p>}
        {state.kind === 'outside' && (
          <p>{t('افتح هذه الصفحة من لوحة تحكم متجرك في سلة: التطبيقات ← تجربة.', 'Open this page from your Salla store’s dashboard: Apps → Tajribah.')}</p>
        )}
        {state.kind === 'problem' && (
          <>
            <p role="alert" style={{ color: 'var(--warn)' }}>{problemText(state.code, t)}</p>
            <button type="button" className="btn btn-ghost" onClick={() => { setState({ kind: 'checking' }); setAttempt((n) => n + 1); }}>
              <RefreshCw size={16} aria-hidden />{t('حاول مرة أخرى', 'Try again')}
            </button>
          </>
        )}
        {state.kind === 'ready' && state.view.linked && (
          <>
            <p><CheckCircle2 size={16} aria-hidden style={{ verticalAlign: '-3px', color: 'var(--teal-ink)' }} /> {t('متجرك على سلة مربوط بحسابك في تجربة. منتجاتك تُحدَّث تلقائيًا.', 'Your Salla store is linked to your Tajribah account. Your products stay up to date on their own.')}</p>
            <button type="button" className="btn btn-primary" onClick={() => open('/dashboard')}>
              <ExternalLink size={16} aria-hidden />{t('افتح تجربة', 'Open Tajribah')}
            </button>
          </>
        )}
        {state.kind === 'ready' && !state.view.linked && state.view.ready && state.view.ticket && (
          <>
            <p>{t('اربط هذا المتجر بحسابك في تجربة لتظهر منتجاتك هناك. ستُفتح تجربة؛ سجّل الدخول (أو أنشئ حسابًا) ويكتمل الربط.', 'Link this store to your Tajribah account so your products appear there. Tajribah opens; sign in (or create an account) and the link completes.')}</p>
            <button type="button" className="btn btn-primary" onClick={() => open(`/dashboard/connections?salla=${encodeURIComponent(state.view.ticket!)}`)}>
              <Link2 size={16} aria-hidden />{t('اربط بحسابي في تجربة', 'Link to my Tajribah account')}
            </button>
            <p className="hint" style={{ marginTop: 10 }}>{t('الرابط صالح لعشر دقائق. إن انتهى، افتح التطبيق من سلة مجددًا.', 'The link works for ten minutes. If it expires, open the app from Salla again.')}</p>
          </>
        )}
        {state.kind === 'ready' && !state.view.linked && !state.view.ready && (
          <>
            <p>{t('لم تُرسل سلة صلاحية متجرك بعد — يحدث ذلك عادةً خلال دقيقة من التثبيت.', 'Salla has not handed over your store’s access yet — it usually arrives within a minute of installing.')}</p>
            <button type="button" className="btn btn-ghost" onClick={() => { setState({ kind: 'checking' }); setAttempt((n) => n + 1); }}>
              <RefreshCw size={16} aria-hidden />{t('تحقّق مجددًا', 'Check again')}
            </button>
          </>
        )}
      </div>
      </main>
    </div>
  );
}

/** What went wrong, in the merchant's language. */
function problemText(code: string, t: (ar: string, en: string) => string): string {
  if (code === 'forbidden') return t('لم تؤكّد سلة هذه الجلسة — افتح تجربة من لوحة تحكم متجرك في سلة مجددًا.', 'Salla did not confirm this session — open Tajribah again from your Salla dashboard.');
  if (code === 'not_implemented') return t('ربط متاجر سلة غير متاح بعد.', 'Linking Salla stores is not available yet.');
  if (code.startsWith('upstream_')) return t('سلة لا تجيب الآن — حاول بعد قليل.', 'Salla is not answering right now — try again shortly.');
  return t('تعذّر التحقق من متجرك. حاول مرة أخرى.', 'Your store could not be checked. Try again.');
}
