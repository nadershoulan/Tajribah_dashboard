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
import { shareLinkOf } from '@site/lib/share-picture';
import { useCompareChoices } from '@site/components/tryon/use-compare-choices';
import { TelemetryContext } from '@site/components/tryon/telemetry';
import { EVENTS_ENDPOINT } from '@site/lib/page-events';
import type { Telemetry } from '@site/lib/tryon-telemetry';
import { SiteEnvContext, SiteLink, useSiteEnv } from '@site/lib/site-env';
import type { TryOnProduct } from '@site/lib/demo-product';
import { brandFrom, CLOSE_MESSAGE, SHOWN_MESSAGE, SIZE_MESSAGE, PREVIEW_CONFIG, PREVIEW_HEIGHT, PREVIEW_READY, configBase, configUrl, embedTitle, isLocalHost, tryOnProductFrom, validRefs, type StoreBrand } from '@site/lib/tryon-config';
import { servesHere } from '@site/lib/store-host';
import { StoreMark } from '@site/components/site/store-mark';
import { MonoMark } from '@site/components/site/mono-mark';
import TryOnFor from '@site/components/tryon/TryOnFor';
import { COMPANY } from '@site/lib/site';

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

  // T140.1: the store's other try-on products of this kind, to compare on the shopper's photo (read once it is ready)
  const choices = useCompareChoices(state.kind === 'ready' && !previewing ? state.product : null, () => {
    if (params().get('preview')) return null;
    const p = params();
    return { store: p.get('store') ?? '', ref: p.get('product'), base: p.get('base') };
  });

  // T140.5: the try-on's anonymous counts, for this store and product (never in the dashboard's preview; on this
  // computer, its own collector)
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  useEffect(() => {
    if (previewing || params().get('preview')) { setTelemetry(null); return; }
    const p = params();
    setTelemetry(p.get('store') && p.get('product') ? { store: p.get('store')!, product: p.get('product')!, endpoint: onThisMachine() ? `${location.origin}/v1/e` : EVENTS_ENDPOINT } : null);
  }, [previewing]);

  const brand = state.kind === 'ready' ? state.brand ?? null : null;
  useEffect(() => { if (brand) document.title = embedTitle(brand, lang); }, [brand, lang]);

  // The merchant's images are absolute CDN addresses; site files still go through the shell.
  const embedEnv = useMemo(() => ({
    ...env,
    asset: (path: string) => (/^https?:\/\//.test(path) ? path : env.asset(path)),
    // T137: the CDN allows CORS and the studio asks for it, so the picture can be saved (a store picture that does not: a notice)
    features: { ...env.features, download: true },
  }), [env]);

  const close = () => window.parent?.postMessage({ type: CLOSE_MESSAGE }, '*');
  // T137: the link a shopper shares with their picture, for others to try the product — the store page the window is
  // over (the widget says which; trusted only when the browser's own record of the framing page is that same site),
  // else the product's own try-on page on this site.
  const [shareLink, setShareLink] = useState<string | null>(null);
  useEffect(() => { setShareLink(shareLinkOf(params(), document.referrer, location.origin)); }, []);
  // T100: in a shop's popup, the bar (with its close button) is up: the popup hides its own backup close
  useEffect(() => { if (inPopup && window.parent !== window) window.parent.postMessage({ type: SHOWN_MESSAGE }, '*'); }, [inPopup]);
  // T137: in a shop's window, say how tall the content is — on a phone the window fits it (no empty band above the
  // price, the store seen round it). A photo's stage is capped by the phone's screen (not this frame's, which follows).
  useEffect(() => {
    if (!inPopup || window.parent === window) return;
    document.documentElement.style.setProperty('--screen-h', `${screen.height}px`);
    const root = document.querySelector<HTMLElement>('.embed-root');
    if (!root || typeof ResizeObserver === 'undefined') return;
    let last = 0;
    const post = () => {
      // the camera (opened from «عليّ», or a product on the phone only) and the info screen (any dialog) take all the
      // window can give — a short window would cut them (Nader: the info screen ran off it)
      const height = document.querySelector('main.cap, [data-slot="dialog-content"]') ? 4000 : Math.ceil(root.scrollHeight);
      if (Math.abs(height - last) > 2) { last = height; window.parent.postMessage({ type: SIZE_MESSAGE, height }, '*'); }
    };
    const watch = new ResizeObserver(post);
    watch.observe(root);
    for (const child of Array.from(root.children)) watch.observe(child);
    const opened = new MutationObserver(post); // the studio's camera and its dialogs open at the end of the page
    opened.observe(document.body, { childList: true });
    post();
    return () => { watch.disconnect(); opened.disconnect(); };
  }, [inPopup, state.kind]);

  // T137 (Nader): on a phone the bar goes — its mark onto the picture, its close beside the tabs (where the help button was;
  // the help goes onto the picture's corner), the privacy line into the help screen. Shown only there by CSS; the bar
  // stays for a computer and while loading.
  const mark = brand
    ? <span className="stage-mark"><StoreMark brand={brand} /></span>
    // T137 (Nader): the watermark is just the mark, in one gray — no words
    : <a className="stage-mark is-icon" href={`${COMPANY.siteUrl}/?utm_source=tryon&utm_medium=watermark`} target="_blank" rel="noopener" aria-label={t('بدعم من تجربة — يفتح موقع تجربة', 'Powered by Tajribah — opens Tajribah’s website')} title={t('بدعم من تجربة', 'Powered by Tajribah')}><MonoMark size={16} /></a>;
  const onPicture = mark;
  const besideTabs = <button type="button" className="icon-button topbar-close" onClick={close} aria-label={t('أغلق التجربة', 'Close the try-on')}><X size={19} aria-hidden /></button>;
  const inHelp = (
    <p className="help-privacy">
      <ShieldCheck size={15} aria-hidden />
      <SiteLink href="/try-on-privacy" target="_blank" rel="noopener">{t('تُعالج صورك على جهازك — التفاصيل', 'Your photos are processed on your device — details')}</SiteLink>
      {!brand && <a className="help-powered" href={`${COMPANY.siteUrl}/?utm_source=tryon&utm_medium=help`} target="_blank" rel="noopener"><MonoMark size={14} />{t('بدعم من تجربة', 'Powered by Tajribah')}</a>}
    </p>
  );

  return (
    <div className={'embed-root' + (previewing ? ' is-preview' : '') + (inPopup ? ' is-popup' : '')}>
      {!previewing && <div className="embed-bar">
        {/* T101: a small mark that opens Tajribah's website, in a new tab — a store under white-label shows its own name instead */}
        {brand ? <span className="embed-brand"><StoreMark brand={brand} /></span> : (
          <a className="embed-brand embed-watermark" href={`${COMPANY.siteUrl}/?utm_source=tryon&utm_medium=watermark`} target="_blank" rel="noopener" aria-label={t('تجربة — يفتح موقع تجربة في نافذة جديدة', 'Tajribah — opens Tajribah’s website in a new tab')}>
            <MonoMark size={22} />
          </a>
        )}
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
          {/* T135: the studio, or — on the phone only — the camera try-on (a QR code on a computer) */}
          <TelemetryContext.Provider value={telemetry}>
          <TryOnFor product={state.product} brand={brand} onClose={previewing ? undefined : close} shareLink={shareLink} compareWith={choices}
            stageExtras={previewing ? null : onPicture} helpExtra={previewing ? null : inHelp} topbarExtra={previewing ? null : besideTabs} />
          </TelemetryContext.Provider>
        </SiteEnvContext.Provider>
      )}
    </div>
  );
}
