'use client';

/**
 * P5 (T26) — the owner's try-on studio, unchanged, for one merchant's watch. The storefront
 * script opens this page in a frame over the product page; it has no site chrome.
 *
 * The product comes from Tajribah's own config host, by store key and product reference — never
 * from the page's address — so this page can only ever show what a merchant published (anything
 * put in the URL would let a link show any picture under our domain). The config is checked as
 * strictly as the widget checks it: https images only, a case width a watch can have.
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
import type { Bi } from '@/lib/lang';
import { SiteEnvContext, SiteLink, useSiteEnv } from '@/lib/site-env';
import type { TryOnProduct } from '@/lib/demo-product';
import Studio from '@/components/studio/Studio';

/** Where published configs live (the same host the storefront widget reads). */
export const CONFIG_BASE = 'https://cfg.tajribah.com/v1';
/** What the frame tells the page it sits on. The widget listens only to our origin. */
export const CLOSE_MESSAGE = 'tajribah:tryon:close';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const onThisMachine = () => typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
/** https only — except a local test page may use a local http server (a public page never is local). */
const httpsUrl = (v: unknown): v is string => {
  if (!str(v, 2048)) return false;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' || (onThisMachine() && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch { return false; }
};

/** The studio's product from a published config, or null when anything about it is wrong. */
export function tryOnProductFrom(config: unknown): TryOnProduct | null {
  if (!isObj(config) || config.v !== 1 || !isObj(config.product) || !isObj(config.tryon)) return null;
  const { product, tryon } = config;
  if (!str(product.name) || !(product.nameAr == null || str(product.nameAr))) return null;
  if (!httpsUrl(tryon.worn) || !httpsUrl(tryon.flat)) return null;
  if (typeof tryon.caseMm !== 'number' || !Number.isFinite(tryon.caseMm) || tryon.caseMm < 5 || tryon.caseMm > 80) return null;
  if (!(tryon.sku == null || str(tryon.sku, 64))) return null;
  const name: Bi = { ar: (product.nameAr as string | null) ?? product.name, en: product.name };
  return {
    sku: (tryon.sku as string | null | undefined) ?? '—',
    collection: { ar: 'تجربة افتراضية', en: 'Virtual try-on' },
    headLead: { ar: 'جرّبها', en: 'Try it' },
    headEm: { ar: 'قبل أن تشتري.', en: 'before you buy.' },
    name,
    finish: isObj(tryon.finish) && str(tryon.finish.ar, 80) && str(tryon.finish.en, 80)
      ? { ar: tryon.finish.ar, en: tryon.finish.en }
      : { ar: 'بمقاسها الحقيقي', en: 'At its real size' },
    caseMm: tryon.caseMm,
    worn: tryon.worn,
    flat: tryon.flat,
    storeUrl: '',
    alt: name,
    storeLink: null, // the shopper is already on the store's page
    demo: false,
  };
}

/** `store` and `product` from the address (a query in the app, after the hash in the preview). */
function params(): URLSearchParams {
  const query = location.search || (location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : '');
  return new URLSearchParams(query);
}

/** Tests on this machine point at a local config; a public page never can. */
function configBase(p: URLSearchParams): string {
  return onThisMachine() && p.get('base') ? p.get('base')! : CONFIG_BASE;
}

type State = { kind: 'loading' } | { kind: 'ready'; product: TryOnProduct } | { kind: 'unavailable' };

export default function EmbedTryOn() {
  const { t, lang, setLang } = useLang();
  const env = useSiteEnv();
  const [state, setState] = useState<State>({ kind: 'loading' });

  // The frame speaks the language of the page it opens over.
  useEffect(() => {
    const wanted = params().get('lang');
    if ((wanted === 'ar' || wanted === 'en') && wanted !== lang) setLang(wanted);
  }, [lang, setLang]);

  useEffect(() => {
    const p = params();
    const store = p.get('store') ?? '';
    const product = p.get('product') ?? '';
    const valid = /^[a-z0-9-]{1,64}$/i.test(store) && !!product && product.length <= 200;
    let live = true;
    const url = `${configBase(p).replace(/\/+$/, '')}/${encodeURIComponent(store)}/${encodeURIComponent(product)}.json`;
    // An address that cannot name a published config is simply "unavailable" — nothing is fetched.
    (valid ? fetch(url, { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null))
      .then((json) => { if (!live) return; const found = tryOnProductFrom(json); setState(found ? { kind: 'ready', product: found } : { kind: 'unavailable' }); })
      .catch(() => { if (live) setState({ kind: 'unavailable' }); });
    return () => { live = false; };
  }, []);

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
