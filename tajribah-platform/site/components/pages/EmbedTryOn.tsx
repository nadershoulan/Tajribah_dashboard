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
 *
 * T61 — white-label: an Enterprise store's config carries its name and logo, and the bar and the
 * page title show them in place of Tajribah's.
 *
 * T85 — `?preview=1`: the dashboard frames this page to show a merchant any product as a shopper would
 * see it, from its drafts. The dashboard reads them with the merchant's sign-in and hands them over by
 * message; only a parent page on this same address is listened to, so another site framing this page
 * can show nothing but what it could already put on its own page. No close button: the dashboard is
 * the page around it.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { useLang } from '@site/lib/i18n';
import { SiteEnvContext, SiteLink, useSiteEnv } from '@site/lib/site-env';
import type { TryOnProduct } from '@site/lib/demo-product';
import { brandFrom, CLOSE_MESSAGE, SHOWN_MESSAGE, PREVIEW_CONFIG, PREVIEW_HEIGHT, PREVIEW_READY, configBase, configUrl, embedTitle, isLocalHost, tryOnProductFrom, validRefs, type StoreBrand } from '@site/lib/tryon-config';
import { servesHere } from '@site/lib/store-host';
import { StoreMark } from '@site/components/site/store-mark';
import Studio from '@site/components/studio/Studio';

/** `store` and `product` from the address (a query in the app, after the hash in the preview). */
function params(): URLSearchParams {
  const query = location.search || (location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '');
  return new URLSearchParams(query);
}

const onThisMachine = () => typeof location !== 'undefined' && isLocalHost(location.hostname);

export type EmbedState = { kind: 'loading' } | { kind: 'ready'; product: TryOnProduct; brand?: StoreBrand | null } | { kind: 'unavailable' };

/** `storeHost`: the store's own address this page is on (P1.19) — then only that store's watches are shown. */
/** The address does not change while the frame is open: nothing to subscribe to. */
const noSubscription = () => () => {};

export default function EmbedTryOn({ initial, storeHost = null }: { initial?: EmbedState; storeHost?: string | null } = {}) {
  const { t, lang, setLang } = useLang();
  const env = useSiteEnv();
  const [state, setState] = useState<EmbedState>(initial ?? { kind: 'loading' });

  // The frame speaks the language of the page it opens over.
  useEffect(() => {
    const wanted = params().get('lang');
    if ((wanted === 'ar' || wanted === 'en') && wanted !== lang) setLang(wanted);
  }, [lang, setLang]);

  const [previewing, setPreviewing] = useState(false); // once the dashboard has answered: the server drew the page without it
  // T100: opened as a popup over the shop's product page (`view=popup`): the shopper is on the product already, so
  // only the studio shows. Read from the address after hydration (the server never sees it: no mismatch).
  const inPopup = useSyncExternalStore(noSubscription, () => params().get('view') === 'popup', () => false);

  useEffect(() => {
    if (!params().get('preview') || window.parent === window) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const data = event.data as { type?: unknown; config?: unknown } | null;
      if (data?.type !== PREVIEW_CONFIG) return;
      const found = tryOnProductFrom(data.config, onThisMachine());
      setPreviewing(true);
      setState(found ? { kind: 'ready', product: found } : { kind: 'unavailable' });
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: PREVIEW_READY }, location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // T87: in the dashboard's preview, the page tells the dashboard its height as it changes.
  useEffect(() => {
    if (!previewing) return;
    const send = () => window.parent.postMessage({ type: PREVIEW_HEIGHT, height: Math.ceil(document.documentElement.scrollHeight) }, location.origin);
    const observer = new ResizeObserver(send);
    observer.observe(document.body);
    send();
    return () => observer.disconnect();
  }, [previewing]);

  useEffect(() => {
    if (initial || params().get('preview')) return; // the server already answered, or the dashboard's preview
    const p = params();
    const store = p.get('store') ?? '';
    const product = p.get('product') ?? '';
    const valid = validRefs(store, product);
    let live = true;
    // T75: on this computer, this app's own configs (`/v1`, served by the Worker) unless `base` names another.
    const url = configUrl(configBase(p.get('base') ?? (onThisMachine() ? `${location.origin}/v1` : null), onThisMachine()), store, product);
    // An address that cannot name a published config is simply "unavailable" — nothing is fetched.
    (valid ? fetch(url, { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null))
      .then((json) => { if (!live) return; const found = servesHere(storeHost, (json as { host?: string | null } | null)?.host) ? tryOnProductFrom(json, onThisMachine()) : null; setState(found ? { kind: 'ready', product: found, brand: brandFrom(json, onThisMachine()) } : { kind: 'unavailable' }); })
      .catch(() => { if (live) setState({ kind: 'unavailable' }); });
    return () => { live = false; };
  }, [initial, storeHost]);

  const brand = state.kind === 'ready' ? state.brand ?? null : null;
  useEffect(() => { if (brand) document.title = embedTitle(brand, lang); }, [brand, lang]);

  // The merchant's images are absolute CDN addresses; site files still go through the shell.
  const embedEnv = useMemo(() => ({
    ...env,
    asset: (path: string) => (/^https?:\/\//.test(path) ? path : env.asset(path)),
    features: { ...env.features, download: false },
  }), [env]);

  const close = () => window.parent?.postMessage({ type: CLOSE_MESSAGE }, '*');
  // T100: in a shop's popup, the bar (with its close button) is up: the popup hides its own backup close
  useEffect(() => { if (inPopup && window.parent !== window) window.parent.postMessage({ type: SHOWN_MESSAGE }, '*'); }, [inPopup]);

  return (
    <div className={'embed-root' + (previewing ? ' is-preview' : '') + (inPopup ? ' is-popup' : '')}>
      {!previewing && <div className="embed-bar">
        <span className="embed-brand">{brand ? <StoreMark brand={brand} /> : t('تجربة', 'Tajribah')}</span>
        <SiteLink href="/try-on-privacy" target="_blank" rel="noopener" className="embed-privacy">
          <ShieldCheck size={15} aria-hidden />{t('تُعالج صورك على جهازك', 'Your photos are processed on your device')}
        </SiteLink>
        <button type="button" className="embed-close" onClick={close} aria-label={t('أغلق التجربة', 'Close the try-on')}><X size={20} aria-hidden /></button>
      </div>}
      {state.kind === 'loading' && <p className="embed-note" role="status">{t('جارٍ التحميل…', 'Loading…')}</p>}
      {state.kind === 'unavailable' && (
        <div className="embed-note">
          <p>{previewing ? t('لا صورة لهذا المنتج نجرّبها بعد.', 'This product has no picture to try on yet.') : t('التجربة غير متاحة لهذا المنتج الآن.', 'The try-on is not available for this product right now.')}</p>
          {!previewing && <button type="button" className="primary-button" onClick={close}>{t('العودة إلى المنتج', 'Back to the product')}</button>}
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
