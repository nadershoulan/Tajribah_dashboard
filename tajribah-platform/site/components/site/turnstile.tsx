'use client';

/**
 * T115 — Cloudflare Turnstile, the "are you human?" check under the contact form. Loaded once, rendered
 * explicitly; the token it gives is checked on the server (server/core/http/turnstile.ts). The page's CSP
 * allows its script through 'strict-dynamic' and its frame through frame-src (site/lib/security.ts).
 */
import { useEffect, useRef } from 'react';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile did not load')));
    s.onerror = () => { loading = null; reject(new Error('turnstile did not load')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** T120: `action` names the form (contact, login, register); the server refuses a token earned on another one. */
export function Turnstile({ siteKey, lang, onToken, resetKey, action = 'contact' }: { siteKey: string; lang: 'ar' | 'en'; onToken: (token: string | null) => void; resetKey: number; action?: 'contact' | 'login' | 'register' }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenFn = useRef(onToken);
  useEffect(() => { tokenFn.current = onToken; }, [onToken]);

  useEffect(() => {
    let gone = false;
    loadTurnstile().then((api) => {
      if (gone || !box.current) return;
      // The normal widget is a fixed 300px; on the smallest phones the form has less, and it pushed the page
      // sideways — there Turnstile's compact size (150px) fits.
      const size = box.current.clientWidth < 300 ? 'compact' : 'normal';
      widget.current = api.render(box.current, {
        sitekey: siteKey, action, language: lang, theme: 'auto', size,
        callback: (token: string) => tokenFn.current(token),
        'expired-callback': () => tokenFn.current(null),
        'error-callback': () => tokenFn.current(null),
      });
    }, () => tokenFn.current(null));
    return () => { gone = true; if (widget.current) window.turnstile?.remove(widget.current); widget.current = null; };
  }, [siteKey, lang, action]);

  // After a send, a fresh check for the next message (a token is good once).
  useEffect(() => { if (resetKey && widget.current) { window.turnstile?.reset(widget.current); tokenFn.current(null); } }, [resetKey]);

  return <div ref={box} className="turnstile-box" style={{ minHeight: 65, maxWidth: '100%', overflow: 'hidden' }} />;
}
