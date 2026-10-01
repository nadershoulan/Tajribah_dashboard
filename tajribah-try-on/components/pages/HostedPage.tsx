'use client';

/**
 * P1.19 — a product's own page: the link a merchant shares in a post, a message or a bio. The
 * product in 3D with "view in your space" on the shopper's phone, a watch in the owner's studio
 * (unchanged — the merchant's buy link goes in its existing store link), and a button to buy it in
 * the merchant's shop. Reads only the published config (`lib/hosted-page.ts`); the server reads it
 * first, and the browser only when the server could not.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, ExternalLink, ShieldCheck } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { SiteEnvContext, SiteLink, useSiteEnv } from '@/lib/site-env';
import { arPath, detectDevice, hostedProductFrom, MESHOPT_DECODER_FILE, sizeParts, VIEWER_AR_MODES, VIEWER_SRC, type HostedProduct } from '@/lib/hosted-page';
import { configBase, configUrl, isLocalHost, validRefs } from '@/lib/tryon-config';
import { servesHere } from '@/lib/store-host';
import { StoreMark } from '@/components/site/store-mark';
import Studio from '@/components/studio/Studio';

export type HostedState = { kind: 'loading' } | { kind: 'ready'; product: HostedProduct } | { kind: 'unavailable' };

const onThisMachine = () => typeof location !== 'undefined' && isLocalHost(location.hostname);
/** The address's query (in the app), or the part after the hash's `?` (in the preview). */
const query = () => {
  if (typeof location === 'undefined') return new URLSearchParams();
  return new URLSearchParams(location.search || (location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : ''));
};

/** `storeHost`: the store's own address this page is on — then only that store's products are shown. */
export default function HostedPage({ initial, store, product, storeHost = null }: { initial?: HostedState; store: string; product: string; storeHost?: string | null }) {
  const { t, lang, setLang } = useLang();
  const env = useSiteEnv();
  const [state, setState] = useState<HostedState>(initial ?? { kind: 'loading' });

  useEffect(() => {
    const wanted = query().get('lang');
    if ((wanted === 'ar' || wanted === 'en') && wanted !== lang) setLang(wanted);
  }, [lang, setLang]);

  useEffect(() => {
    if (initial) return; // the server already answered
    let live = true;
    // An address that cannot name a published config is simply "unavailable" — nothing is fetched.
    (validRefs(store, product)
      ? fetch(configUrl(configBase(query().get('base'), onThisMachine()), store, product), { credentials: 'omit' }).then((r) => (r.ok ? r.json() : null))
      : Promise.resolve(null))
      .then((json) => { if (live) { const found = hostedProductFrom(json, onThisMachine()); setState(found && servesHere(storeHost, found.host) ? { kind: 'ready', product: found } : { kind: 'unavailable' }); } })
      .catch(() => { if (live) setState({ kind: 'unavailable' }); });
    return () => { live = false; };
  }, [initial, store, product, storeHost]);

  // The merchant's pictures are absolute addresses; the site's own files still go through the shell.
  const studioEnv = useMemo(() => ({
    ...env,
    asset: (path: string) => (/^https?:\/\//.test(path) ? path : env.asset(path)),
    features: { ...env.features, download: false },
  }), [env]);

  const p = state.kind === 'ready' ? state.product : null;
  const name = p ? t(p.name.ar, p.name.en) : '';
  const storeName = p ? t(p.store.ar, p.store.en) : '';
  const size = p ? sizeParts(p, lang) : null;

  return (
    <div className="hosted-root">
      <header className="hosted-bar">
        <span className="embed-brand">{p?.brand ? <StoreMark brand={p.brand} /> : storeName || t('تجربة', 'Tajribah')}</span>
        <button type="button" className="hosted-lang" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} lang={lang === 'ar' ? 'en' : 'ar'}>
          {lang === 'ar' ? 'English' : 'العربية'}
        </button>
      </header>

      {state.kind === 'loading' && <p className="embed-note" role="status">{t('جارٍ التحميل…', 'Loading…')}</p>}
      {state.kind === 'unavailable' && (
        <div className="embed-note">
          <Box size={28} aria-hidden />
          <p>{t('صفحة هذا المنتج غير متاحة الآن.', 'This product’s page is not available right now.')}</p>
        </div>
      )}

      {p && (
        <main className="hosted-main">
          {/* A watch: the studio is the page, with its own heading, name and size — not said twice. */}
          {!p.tryon && (
            <div className="hosted-head">
              <p className="eyebrow">{t('جرّبها قبل أن تشتريها', 'Try it before you buy it')}</p>
              <h1>{name}</h1>
              {size && <p className="hosted-size">{t('المقاس الحقيقي', 'True size')}: <strong><bdi dir="ltr">{size.dims}</bdi> {size.unit}</strong></p>}
            </div>
          )}

          {p.tryon && (
            <SiteEnvContext.Provider value={studioEnv}>
              <Studio product={p.tryon} />
            </SiteEnvContext.Provider>
          )}

          {p.model && <ModelStage product={p} name={name} />}

          {p.shopUrl && !p.tryon && (
            <a className="primary-button hosted-buy" href={p.shopUrl} target="_blank" rel="noopener">
              {t(`اشترها من ${p.store.ar}`, `Buy it at ${p.store.en}`)}<ExternalLink size={16} aria-hidden />
            </a>
          )}

          <footer className="hosted-foot">
            {p.tryon && (
              <SiteLink href="/try-on-privacy" target="_blank" rel="noopener" className="embed-privacy">
                <ShieldCheck size={15} aria-hidden />{t('تُعالج صورك على جهازك', 'Your photos are processed on your device')}
              </SiteLink>
            )}
            {p.poweredBy && <SiteLink href="/" className="hosted-made">{t('بتقنية تجربة', 'Powered by Tajribah')}</SiteLink>}
          </footer>
        </main>
      )}
    </div>
  );
}

type ViewerElement = HTMLElement & { canActivateAR?: boolean; activateAR?: () => Promise<void> };
type ViewerScope = { ModelViewerElement?: { meshoptDecoderLocation?: string } };

/** The viewer's address: Tajribah's file host — or, only on this machine, a local test server. */
function viewerSrc(): string {
  const wanted = query().get('viewer');
  if (!wanted || !onThisMachine()) return VIEWER_SRC;
  try { return isLocalHost(new URL(wanted).hostname) ? wanted : VIEWER_SRC; } catch { return VIEWER_SRC; }
}

let viewerLoading: Promise<void> | null = null;
function loadViewer(src: string): Promise<void> {
  viewerLoading ??= new Promise<void>((resolve, reject) => {
    if (customElements.get('model-viewer')) { resolve(); return; }
    // Every web GLB is meshopt-compressed; the viewer decodes it only when told where the decoder is.
    const scope = globalThis as unknown as ViewerScope;
    scope.ModelViewerElement ??= {};
    scope.ModelViewerElement.meshoptDecoderLocation ??= new URL(MESHOPT_DECODER_FILE, src).href;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => { viewerLoading = null; reject(new Error('viewer did not load')); };
    document.head.appendChild(script);
  });
  return viewerLoading;
}

/** The product in 3D, turning in the page, and "view in your space" where the phone can. */
function ModelStage({ product, name }: { product: HostedProduct; name: string }) {
  const { t } = useLang();
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<ViewerElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState(false);
  const model = product.model!;
  // A watch or glasses are tried on, not placed in a room — the studio covers them.
  const placeable = product.placement !== 'wrist' && product.placement !== 'face';

  useEffect(() => {
    let live = true;
    loadViewer(viewerSrc()).then(() => {
      if (!live || !host.current) return;
      const el = document.createElement('model-viewer') as ViewerElement;
      el.setAttribute('src', model.glb);
      if (model.usdz) el.setAttribute('ios-src', model.usdz);
      el.setAttribute('alt', name);
      el.setAttribute('ar', '');
      el.setAttribute('ar-modes', VIEWER_AR_MODES);
      el.setAttribute('ar-placement', product.placement === 'wall' ? 'wall' : 'floor');
      el.setAttribute('camera-controls', '');
      el.setAttribute('shadow-intensity', String(product.shadow));
      el.setAttribute('scale', `${product.scale} ${product.scale} ${product.scale}`);
      if (product.autoRotate) el.setAttribute('auto-rotate', '');
      host.current.replaceChildren(el);
      viewer.current = el;
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [model.glb, model.usdz, name, product.autoRotate, product.placement, product.scale, product.shadow]);

  const place = async () => {
    setNote(false);
    const probe = document.createElement('a');
    const device = detectDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0, !!probe.relList?.supports?.('ar'));
    const path = arPath(device, { model, placement: product.placement, name: product.name.ar }, location.href);
    if (path.kind === 'quick-look') {
      // Quick Look opens from a rel="ar" link holding an image, in the document itself.
      const link = document.createElement('a');
      link.rel = 'ar';
      link.href = path.href;
      link.style.display = 'none';
      link.appendChild(document.createElement('img'));
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    if (path.kind === 'scene-viewer') { location.href = path.href; return; }
    if (viewer.current?.canActivateAR && viewer.current.activateAR) { await viewer.current.activateAR(); return; }
    setNote(true);
  };

  return (
    <section className="hosted-stage" aria-label={t('العرض ثلاثي الأبعاد', '3D view')}>
      <div ref={host} className="hosted-viewer">
        {failed && <p className="embed-note">{t('تعذّر فتح العرض ثلاثي الأبعاد الآن. حاول مرة أخرى بعد قليل.', 'The 3D view could not open right now. Please try again shortly.')}</p>}
      </div>
      {placeable && !failed && (
        <div className="hosted-actions">
          <button type="button" className="primary-button" onClick={() => void place()}>
            <Box size={18} aria-hidden />{t('شاهدها في مكانك', 'View in your space')}
          </button>
          {note && <p className="hosted-hint" role="status">{t('افتح هذه الصفحة في هاتفك لتضع المنتج في مكانك بمقاسه الحقيقي.', 'Open this page on your phone to place the product in your space at its real size.')}</p>}
        </div>
      )}
      <p className="hosted-hint">{t('اسحب لتدوير المنتج، وقرّب بإصبعين.', 'Drag to turn it; pinch to zoom.')}</p>
    </section>
  );
}
