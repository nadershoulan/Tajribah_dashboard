'use client';

/**
 * T120 — Cloudflare Turnstile on the sign-in and sign-up forms. The site key (public) is put in the page by the
 * dashboard layout as <meta name="turnstile-site-key">; without it (this computer, the static preview) there is no
 * widget and no token, and the server does not ask for one. A token is good once, so after every refused attempt
 * the widget is reset for a fresh one.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { Turnstile } from '@site/components/site/turnstile';
import { useLang } from '@/lib/i18n';

export const TURNSTILE_META = 'turnstile-site-key';

const noSubscribe = () => () => {};
const readSiteKey = () => document.querySelector<HTMLMetaElement>(`meta[name="${TURNSTILE_META}"]`)?.content || null;

export function useAuthTurnstile(action: 'login' | 'register') {
  const { lang } = useLang();
  // Read from the page once it is in the browser; none while rendering on the server.
  const siteKey = useSyncExternalStore(noSubscribe, readSiteKey, () => null);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => setResetKey((k) => k + 1), []);
  const widget = siteKey
    ? <div className="field" style={{ display: 'flex', justifyContent: 'center' }}><Turnstile siteKey={siteKey} lang={lang} action={action} onToken={setToken} resetKey={resetKey} /></div>
    : null;
  /** Ready to send: no check on this page, or the check gave its token. */
  const ready = !siteKey || !!token;
  return { widget, token: token ?? undefined, ready, reset };
}

export const TURNSTILE_WAIT = {
  ar: 'انتظر لحظة حتى يكتمل التحقق الأمني أسفل النموذج، ثم حاول مرة أخرى.',
  en: 'Wait a moment for the security check below the form to finish, then try again.',
};
