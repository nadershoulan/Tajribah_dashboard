/**
 * P1.16 — the storefront widget: the one script merchants add to their product pages.
 *
 *   <script src="https://cdn…/w/v1/widget.js" data-tajribah-store="STORE_KEY" async></script>
 *   <div data-tajribah-product="EXTERNAL_PRODUCT_ID"></div>
 *
 * It runs inside other people's shops (§4 D3), so every rule here is about not breaking them.
 * (`appendChild`, not `append`: the Workers types redefine `Element.append` for HTMLRewriter.)
 *  - **After the page.** Nothing runs until the page has loaded, then only when idle.
 *  - **Fails closed.** Every entry point is wrapped; any error, a slow or missing config, an
 *    unknown config version — the placeholder stays empty and nothing reaches the page's own
 *    error handling. A missing button costs a sale; a broken shop costs a merchant.
 *  - **Isolated.** The button lives in a shadow root: the shop's CSS cannot restyle it and its
 *    CSS cannot leak out. One global (`window.Tajribah`), created once however often the
 *    script is included.
 *  - **Never reads our database.** The config comes from the edge (P1.15); if our API is down,
 *    shoppers still see AR.
 *  - **Small.** The heavy viewer (`<model-viewer>`) loads only when a shopper taps (P1.18).
 */
import { parseConfig, type ViewerConfig } from './config';

export const WIDGET_VERSION = '1.0.0';
export const CONFIG_TIMEOUT_MS = 3000;
const DEFAULT_CONFIG_BASE = 'https://cfg.tajribah.com/v1';
const DEFAULT_VIEWER = 'https://cdn.tajribah.com/vendor/model-viewer-4.0.0.min.js';
const READY = 'data-tajribah-ready';
/** The attributes merchants paste (P1.17's snippet is built from these, and tested against them). */
export const ATTR = { store: 'data-tajribah-store', product: 'data-tajribah-product', config: 'data-tajribah-config', viewer: 'data-tajribah-viewer' } as const;
/** Where the widget is served, versioned; the snippet and the install checker both use it. */
export const WIDGET_SRC = 'https://cdn.tajribah.com/w/v1/widget.js';

type Settings = { store: string; configBase: string; viewer: string };

/** Run `fn`; swallow and report anything it throws or rejects with. Never rethrows. */
export function guard<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return Promise.resolve(fn()).catch((error) => { report(error); return undefined; });
  } catch (error) {
    report(error);
    return Promise.resolve(undefined);
  }
}

function report(error: unknown): void {
  // Debug level only: a shop's console is the merchant's, not ours to fill with errors.
  try { console.debug('[tajribah]', error); } catch { /* no console */ }
}

/** Fetch and check one product's config, or null on any failure — including slowness. */
export async function loadConfig(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = CONFIG_TIMEOUT_MS): Promise<ViewerConfig | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', mode: 'cors' });
    if (!response.ok) return null;
    return parseConfig(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function configUrl(base: string, store: string, product: string): string {
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(store)}/${encodeURIComponent(product)}.json`;
}

/** The shop's language decides the button's: Arabic unless the page says English. */
export function pageLang(doc: Document): 'ar' | 'en' {
  return (doc.documentElement.getAttribute('lang') ?? '').toLowerCase().startsWith('en') ? 'en' : 'ar';
}

const STYLE = `
:host{all:initial;display:inline-block}
button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;padding:11px 18px;
 font:600 15px/1.2 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;cursor:pointer;min-height:44px}
button:focus-visible{outline:2px solid currentColor;outline-offset:3px}
svg{width:18px;height:18px;flex:none}
.overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
.sheet{position:relative;width:min(640px,94vw);height:min(640px,80vh);background:#fff;border-radius:16px;overflow:hidden}
.close{position:absolute;top:10px;inset-inline-end:10px;z-index:1;background:#fff;color:#111;border-radius:999px;padding:6px 12px;min-height:0;font-size:14px}
model-viewer{width:100%;height:100%}
`;
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>';

/** Draw the button for `config` into `host` (a shadow root). Returns the button. */
export function renderButton(host: HTMLElement, config: ViewerConfig, lang: 'ar' | 'en', onOpen: () => void): HTMLButtonElement {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = STYLE;
  const button = document.createElement('button');
  button.type = 'button';
  button.dir = lang === 'ar' ? 'rtl' : 'ltr';
  const { color, radius, variant, icon } = config.button;
  button.style.borderRadius = `${radius}px`;
  if (variant === 'solid') { button.style.background = color; button.style.color = '#fff'; }
  else { button.style.border = `2px solid ${color}`; button.style.color = color; }
  if (icon) button.insertAdjacentHTML('beforeend', ICON);
  const label = document.createElement('span');
  label.textContent = lang === 'ar' ? config.button.labelAr : config.button.labelEn; // text, never HTML
  button.appendChild(label);
  button.addEventListener('click', () => { void guard(onOpen); });
  root.appendChild(style);
  root.appendChild(button);
  return button;
}

let viewerLoading: Promise<void> | null = null;
function loadViewer(src: string): Promise<void> {
  viewerLoading ??= new Promise<void>((resolve, reject) => {
    if (customElements.get('model-viewer')) { resolve(); return; }
    const script = document.createElement('script');
    script.type = 'module';
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => { viewerLoading = null; reject(new Error('viewer did not load')); };
    document.head.appendChild(script);
  });
  return viewerLoading;
}

/** The first, simple viewer: `<model-viewer>` in a modal. P1.18 builds the full AR paths. */
async function openViewer(host: HTMLElement, config: ViewerConfig, lang: 'ar' | 'en', settings: Settings): Promise<void> {
  await loadViewer(settings.viewer);
  const root = host.shadowRoot!;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', lang === 'ar' ? config.product.nameAr ?? config.product.name : config.product.name);
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.textContent = lang === 'ar' ? 'إغلاق' : 'Close';
  const viewer = document.createElement('model-viewer');
  viewer.setAttribute('src', config.model.glb);
  if (config.model.usdz) viewer.setAttribute('ios-src', config.model.usdz);
  viewer.setAttribute('ar', '');
  viewer.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
  viewer.setAttribute('ar-placement', config.placement === 'wall' ? 'wall' : 'floor');
  viewer.setAttribute('camera-controls', '');
  viewer.setAttribute('shadow-intensity', String(config.shadow));
  viewer.setAttribute('scale', `${config.scale} ${config.scale} ${config.scale}`);
  if (config.autoRotate) viewer.setAttribute('auto-rotate', '');
  const dismiss = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
  close.addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  document.addEventListener('keydown', onKey);
  sheet.appendChild(close);
  sheet.appendChild(viewer);
  overlay.appendChild(sheet);
  root.appendChild(overlay);
  close.focus();
}

function settingsOf(doc: Document): Settings | null {
  const script = (doc.currentScript as HTMLScriptElement | null) ?? doc.querySelector<HTMLScriptElement>(`script[${ATTR.store}]`);
  const store = script?.getAttribute(ATTR.store);
  if (!store) return null;
  return {
    store,
    configBase: script!.getAttribute(ATTR.config) ?? DEFAULT_CONFIG_BASE,
    viewer: script!.getAttribute(ATTR.viewer) ?? DEFAULT_VIEWER,
  };
}

/** Find placeholders not handled yet, load their configs, draw the buttons. */
export async function mount(doc: Document, settings: Settings, fetchImpl: typeof fetch = fetch): Promise<number> {
  const lang = pageLang(doc);
  let drawn = 0;
  const hosts = Array.from(doc.querySelectorAll<HTMLElement>(`[${ATTR.product}]`)).filter((el) => !el.hasAttribute(READY));
  await Promise.all(hosts.map((host) => guard(async () => {
    host.setAttribute(READY, 'loading');
    const product = host.getAttribute(ATTR.product) ?? '';
    const config = product ? await loadConfig(configUrl(settings.configBase, settings.store, product), fetchImpl) : null;
    if (!config) { host.setAttribute(READY, 'none'); return; } // fail closed: nothing drawn
    renderButton(host, config, lang, () => openViewer(host, config, lang, settings));
    host.setAttribute(READY, 'yes');
    drawn += 1;
  })));
  return drawn;
}

declare global {
  interface Window { Tajribah?: { version: string; refresh(): Promise<number | undefined> } }
}

/** Entry point: once per page, after load, when idle. */
export function boot(win: Window & typeof globalThis = window): void {
  void guard(() => {
    if (win.Tajribah) return; // included twice: the first one serves
    const settings = settingsOf(win.document);
    if (!settings) return;
    const run = () => guard(() => mount(win.document, settings));
    win.Tajribah = { version: WIDGET_VERSION, refresh: run };
    // Safari has no requestIdleCallback, whatever the DOM types say: check at run time.
    const idle = (fn: () => void) => (typeof win.requestIdleCallback === 'function' ? win.requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 1));
    if (win.document.readyState === 'complete') idle(() => { void run(); });
    else win.addEventListener('load', () => idle(() => { void run(); }), { once: true });
  });
}
