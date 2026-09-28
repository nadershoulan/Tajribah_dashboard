'use client';

/**
 * P5 (T26) — the owner's try-on studio, unchanged, for one merchant's watch. The storefront
 * script opens this page in a frame over the product page; it has no site chrome.
 *
 * The product comes from Tajribah's own config host, by store key and product reference — never
 * from the page's address — so this page can only ever show what a merchant published (anything
 * put in the URL would let a link show any picture under our domain). Parsing lives in
 * `lib/tryon-config.ts`. P5.12: the page reads the config on the server and hands it over as
 * `initial`; the browser only reads it itself when the server could not (or in the preview).
 *
 * Downloads are off here: the merchant's images come from the CDN, and the studio draws them onto
 * its canvas without asking for CORS, which would make saving the picture fail. The studio itself
 * is not changed for that — the environment says "no download", as the static preview does.
 *
 * P5.7 — the bar says, before anything is used, that photos are handled on the shopper's device,
 * and links to the full camera & photo privacy page in a new tab (the shop page stays open).
 */
import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { SiteEnvContext, SiteLink, useSiteEnv } from '@/lib/site-env';
import type { TryOnProduct } from '@/lib/demo-product';
import { CLOSE_MESSAGE, configBase, configUrl, isLocalHost, tryOnProductFrom, validRefs } from '@/lib/tryon-config';
import Studio from '@/components/studio/Studio';

/** `store` and `product` from the address (a query in the app, after the hash in the preview). */
function params(): URLSearchParams {
  const query = location.search || (location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '');
  return new URLSearchParams(query);
}

const onThisMachine = () => typeof location !== 'undefined' && isLocalHost(location.hostname);

export type EmbedState = { kind: 'loading' } | { kind: 'ready'; product: TryOnProduct } | { kind: 'unavailable' };

export default function EmbedTryOn({ initial }: { initial?: EmbedState } = {}) {
  const { t, lang, setLang } = useLang();
  const env = useSiteEnv();
  const [state, setState] = useState<EmbedState>(initial ?? { kind: 'loading' });

  // The frame speaks the language of the page it opens over.
  useEffect(() => {
    const wanted = params().get('lang');
    if ((wanted === 'ar' || wanted === 'en') && wanted !== lang) setLang(wanted);
  }, [lang, setLang]);

  useEffect(() => {
    if (initial) return; // the server already answered
    const p = params();
    const store = p.get('store') ?? '';
    const product = p.get('product') ?? '';
    const valid = validRefs(store, product);
    let live = true;
    const url = configUrl(configBase(p.get('base'), onThisMachine()), store, product);
    // An address that cannot name a published config is simply "unavailable" — nothing is fetched.
    (valid ? fetch(url, { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null))
      .then((json) => { if (!live) return; const found = tryOnProductFrom(json, onThisMachine()); setState(found ? { kind: 'ready', product: found } : { kind: 'unavailable' }); })
      .catch(() => { if (live) setState({ kind: 'unavailable' }); });
    return () => { live = false; };
  }, [initial]);

  // The merchant's images are absolute CDN addresses; site files still go through the shell.
  const embedEnv = useMemo(() => ({
    ...env,
    asset: (path: string) => (/^https?:\/\//.test(path) ? path : env.asset(path)),
    features: { ...env.features, download: false },
  }), [env]);

  const close = () => window.parent?.postMessage({ type: CLOSE_MESSAGE }, '*');

  return (
    <div className="embed-root">
      <div className="embed-bar">
        <span className="embed-brand">{t('تجربة', 'Tajribah')}</span>
        <SiteLink href="/try-on-privacy" target="_blank" rel="noopener" className="embed-privacy">
          <ShieldCheck size={15} aria-hidden />{t('تُعالج صورك على جهازك', 'Your photos are processed on your device')}
        </SiteLink>
        <button type="button" className="embed-close" onClick={close} aria-label={t('أغلق التجربة', 'Close the try-on')}><X size={20} aria-hidden /></button>
      </div>
      {state.kind === 'loading' && <p className="embed-note" role="status">{t('جارٍ التحميل…', 'Loading…')}</p>}
      {state.kind === 'unavailable' && (
        <div className="embed-note">
          <p>{t('التجربة غير متاحة لهذا المنتج الآن.', 'The try-on is not available for this product right now.')}</p>
          <button type="button" className="primary-button" onClick={close}>{t('العودة إلى المنتج', 'Back to the product')}</button>
        </div>
      )}
      {state.kind === 'ready' && (
        <SiteEnvContext.Provider value={embedEnv}>
          <Studio product={state.product} />
        </SiteEnvContext.Provider>
      )}
    </div>
  );
}
