'use client';

import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { SiteLink } from '@/lib/site-env';
import {
  ANALYTICS_ON, CONSENT_DEFAULT, CONSENT_GRANTED, CONSENT_KEY, GA_CONFIG, GA_ID, GA_SCRIPT_HOST,
  readChoice, storedChoice, type Choice,
} from '@/lib/analytics';

/** The footer's "Cookie settings" opens the banner again with this event. */
export const OPEN_CONSENT = 'tajribah:consent';

type Gtag = (...args: unknown[]) => void;
declare global { interface Window { dataLayer?: unknown[]; gtag?: Gtag } }

function gtag(): Gtag {
  window.dataLayer = window.dataLayer ?? [];
  // gtag.js reads the arguments object itself, as Google's snippet pushes it.
  // eslint-disable-next-line prefer-rest-params
  window.gtag = window.gtag ?? function gtagShim() { window.dataLayer!.push(arguments); };
  return window.gtag;
}

/** Fetches Google's script only now, after the visitor accepted; once per page. */
function startAnalytics() {
  const g = gtag();
  if (document.getElementById('ga4')) { g('consent', 'update', CONSENT_GRANTED); return; }
  g('consent', 'default', CONSENT_DEFAULT);
  g('consent', 'update', CONSENT_GRANTED);
  g('js', new Date());
  g('config', GA_ID, GA_CONFIG);
  const script = document.createElement('script');
  script.id = 'ga4';
  script.async = true;
  script.src = `${GA_SCRIPT_HOST}/gtag/js?id=${encodeURIComponent(GA_ID ?? '')}`;
  document.head.appendChild(script);
}

/** A change of mind: measuring stops on this page and GA's cookies are removed. */
function stopAnalytics() {
  if (window.gtag) window.gtag('consent', 'update', CONSENT_DEFAULT);
  const host = location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  for (const name of document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n === '_ga' || n.startsWith('_ga_'))) {
    for (const d of domains) document.cookie = `${name}=; path=/; max-age=0${d ? `; domain=${d}` : ''}`;
  }
}

function read(): Choice | null {
  try { return readChoice(window.localStorage.getItem(CONSENT_KEY)); } catch { return null; }
}

export function ConsentBanner() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ANALYTICS_ON) return;
    const choice = read();
    if (choice === 'granted') startAnalytics();
    // Opening after the first paint keeps the server page and the browser's first render the same.
    else if (choice === null) queueMicrotask(() => setOpen(true));
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT, reopen);
  }, []);

  if (!ANALYTICS_ON || !open) return null;

  const decide = (choice: Choice) => {
    try { window.localStorage.setItem(CONSENT_KEY, storedChoice(choice)); } catch { /* private mode: asked again next visit */ }
    if (choice === 'granted') startAnalytics(); else stopAnalytics();
    setOpen(false);
  };

  return (
    <section className="consent" role="region" aria-label={t('ملفات تعريف الارتباط', 'Cookies')}>
      <p>
        {t('نستخدم Google Analytics لنفهم كيف يُستخدم الموقع ونحسّنه، فقط إن وافقت. لا إعلانات ولا بيع للبيانات. ',
          'We use Google Analytics to understand how the site is used and improve it, only if you agree. No advertising and no selling of data. ')}
        <SiteLink href="/cookies">{t('سياسة ملفات تعريف الارتباط', 'Cookie policy')}</SiteLink>
      </p>
      <div className="consent-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => decide('granted')}>{t('أوافق', 'Accept')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => decide('denied')}>{t('أرفض', 'Decline')}</button>
      </div>
    </section>
  );
}

/** For the footer: reopens the banner. Nothing when analytics is off. */
export function ConsentLink() {
  const { t } = useLang();
  if (!ANALYTICS_ON) return null;
  return (
    <button type="button" className="foot-consent" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT))}>
      {t('إعدادات ملفات تعريف الارتباط', 'Cookie settings')}
    </button>
  );
}
