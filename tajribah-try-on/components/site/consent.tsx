'use client';

import { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { SiteLink } from '@/lib/site-env';
import {
  CONSENT_DEFAULT, CONSENT_GRANTED, CONSENT_KEY, GA_CONFIG, GA_SCRIPT_HOST,
  readChoice, storedChoice, type Choice,
} from '@/lib/analytics';
import { useGaId } from '@/lib/analytics-context';

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
function startAnalytics(id: string) {
  const g = gtag();
  if (document.getElementById('ga4')) { g('consent', 'update', CONSENT_GRANTED); return; }
  g('consent', 'default', CONSENT_DEFAULT);
  g('consent', 'update', CONSENT_GRANTED);
  g('js', new Date());
  g('config', id, GA_CONFIG);
  const script = document.createElement('script');
  script.id = 'ga4';
  script.async = true;
  script.src = `${GA_SCRIPT_HOST}/gtag/js?id=${encodeURIComponent(id)}`;
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

function read(key = CONSENT_KEY): Choice | null {
  try { return readChoice(window.localStorage.getItem(key)); } catch { return null; }
}

export function ConsentBanner() {
  const { t } = useLang();
  const id = useGaId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    const choice = read();
    if (choice === 'granted') startAnalytics(id);
    // Opening after the first paint keeps the server page and the browser's first render the same.
    else if (choice === null) queueMicrotask(() => setOpen(true));
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT, reopen);
  }, [id]);

  if (!id || !open) return null;

  const decide = (choice: Choice) => {
    try { window.localStorage.setItem(CONSENT_KEY, storedChoice(choice)); } catch { /* private mode: asked again next visit */ }
    if (choice === 'granted') startAnalytics(id); else stopAnalytics();
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

/**
 * T69 — a store's own GA4 on its products' own pages (`/p/…`): the store is the one measuring, so the
 * banner says so, and the shopper's choice is kept per store (a yes to one store is not a yes to
 * another, nor to Tajribah's website). Same rules as the website's: nothing fetched before a yes,
 * advertising always denied. Without the store's id, nothing at all.
 */
export function StoreConsent({ id, store }: { id: string | null; store: { ar: string; en: string } }) {
  const { t } = useLang();
  const key = `${CONSENT_KEY}:${id ?? ''}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    const choice = read(key);
    if (choice === 'granted') startAnalytics(id);
    else if (choice === null) queueMicrotask(() => setOpen(true));
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT, reopen);
  }, [id, key]);

  if (!id || !open) return null;
  const decide = (choice: Choice) => {
    try { window.localStorage.setItem(key, storedChoice(choice)); } catch { /* private mode: asked again next visit */ }
    if (choice === 'granted') startAnalytics(id); else stopAnalytics();
    setOpen(false);
  };
  return (
    <section className="consent" role="region" aria-label={t('ملفات تعريف الارتباط', 'Cookies')}>
      <p>
        {t(`يستخدم ${store.ar} خدمة Google Analytics ليفهم زيارات هذه الصفحة، فقط إن وافقت. لا إعلانات.`,
          `${store.en} uses Google Analytics to understand visits to this page, only if you agree. No advertising.`)}
      </p>
      <div className="consent-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => decide('granted')}>{t('أوافق', 'Accept')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => decide('denied')}>{t('أرفض', 'Decline')}</button>
      </div>
    </section>
  );
}

/** For the footer: reopens the banner. Nothing when analytics is off. */
export function ConsentLink({ id }: { id?: string | null } = {}) {
  const { t } = useLang();
  const site = useGaId();
  if (!(id === undefined ? site : id)) return null;
  return (
    <button type="button" className="foot-consent" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT))}>
      {t('إعدادات ملفات تعريف الارتباط', 'Cookie settings')}
    </button>
  );
}
