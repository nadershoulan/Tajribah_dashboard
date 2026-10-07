/**
 * P5 (T26) — the owner's try-on studio, opened in a frame over the product page.
 *
 * The studio is not part of this script: it runs, unchanged, on Tajribah's own domain
 * (`tajribah-try-on`, `/embed/try-on`), and this file only opens it. The frame gets the store key
 * and the product reference — the studio loads the product itself from the config host, so
 * nothing in the frame's address can make it show anything a merchant did not publish.
 *
 * A frame rather than mounting the studio in the page: the shop's CSS and scripts cannot reach
 * it, the camera and QR pairing work as they do on the site, and a failure stays inside it.
 */
/** The try-on is a page of the website, on tajribah.com with everything else (T82: one domain and its subdomains). */
export const DEFAULT_TRYON = 'https://tajribah.com/embed/try-on';
/** What the frame posts when the shopper closes it. Only the frame's own origin is listened to. */
export const CLOSE_MESSAGE = 'tajribah:tryon:close';
/** T100: what our frame posts once its page is up, with its own close button (the website's `SHOWN_MESSAGE`). */
export const SHOWN_MESSAGE = 'tajribah:tryon:shown';

/**
 * Where the studio is opened from: the address the shop's script names (a test or a preview), else the
 * store's own address when its config carries one (T62), else Tajribah's.
 */
export function tryOnBase(configured: string, host: string | null): string {
  return configured === DEFAULT_TRYON && host ? `https://${host}/embed/try-on` : configured;
}

/** The frame's address for one product. */
export function tryOnUrl(base: string, store: string, product: string, lang: 'ar' | 'en'): string {
  const url = new URL(base);
  url.searchParams.set('store', store);
  url.searchParams.set('product', product);
  url.searchParams.set('lang', lang);
  return url.href;
}

/** Just enough of a document to add a link to its head (a test passes a fake). */
type HeadDocument = {
  head: { querySelector(selector: string): unknown; appendChild(node: never): unknown } | null;
  createElement(tag: 'link'): { rel: string; href: string };
};

/**
 * P5.12 — when a try-on button is drawn, open the connection to the studio's host (DNS, TCP, TLS)
 * so the shopper's tap does not wait for it. Only the origin, once per page; nothing downloads.
 */
export function warmTryOn(doc: HeadDocument, base: string): boolean {
  let origin: string;
  try { origin = new URL(base).origin; } catch { return false; }
  if (!doc.head || origin === 'null' || doc.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return false;
  const link = doc.createElement('link');
  link.rel = 'preconnect';
  link.href = origin;
  doc.head.appendChild(link as never);
  return true;
}

/** A message of this type from our frame — never from the shop page or another frame. */
function fromFrame(event: { origin: string; data: unknown; source: unknown }, frameOrigin: string, frameWindow: unknown, type: string): boolean {
  return event.origin === frameOrigin && event.source === frameWindow
    && typeof event.data === 'object' && event.data !== null && (event.data as { type?: unknown }).type === type;
}

/** A close from our frame — never from the shop page or another frame. */
export const isCloseFrom = (event: { origin: string; data: unknown; source: unknown }, frameOrigin: string, frameWindow: unknown): boolean => fromFrame(event, frameOrigin, frameWindow, CLOSE_MESSAGE);
/** T100: our frame's page is up, its own close button showing. */
export const isShownFrom = (event: { origin: string; data: unknown; source: unknown }, frameOrigin: string, frameWindow: unknown): boolean => fromFrame(event, frameOrigin, frameWindow, SHOWN_MESSAGE);

/** T100: the popup's own styles — it lives in its own layer, not under the button's. */
export const POPUP_STYLE = `
:host{all:initial}
.tryon{position:fixed;inset:0;z-index:2147483647;background:rgba(15,18,22,.6);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.tryon-sheet{position:relative;width:min(940px,100%);height:min(740px,100%);background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.35)}
.tryon iframe{border:0;width:100%;height:100%;display:block}
.tryon-close{all:unset;box-sizing:border-box;cursor:pointer;position:absolute;bottom:14px;inset-inline-start:14px;background:#111;color:#fff;border-radius:999px;padding:8px 14px;font:600 14px/1.2 system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
.tryon-close:focus-visible{outline:2px solid #fff;outline-offset:2px}
@media (max-width:600px){.tryon{padding:10px}.tryon-sheet{border-radius:14px}}
`;

/** The frame's address in its popup view: the shopper is already on the product page, so only the studio shows. */
export const popupUrl = (src: string): string => { const url = new URL(src); url.searchParams.set('view', 'popup'); return url.href; };

/**
 * Open the frame in a window over the product page (T100: a popup on the same page, the page dimmed behind
 * it — not a full screen). It goes in a layer of its own at the end of the page (`document.body`), not under
 * the button: a store's own sticky column, header or add-to-cart bar can then never draw over it. Escape, a
 * tap outside the window, our close button or the frame's own close message remove it and give the page its
 * scroll back. `root` is the button's shadow root: focus goes back to its button.
 */
export function openTryOn(root: ShadowRoot, src: string, lang: 'ar' | 'en', label: string): () => void {
  // T53: closing gives focus back to the button that opened it — a keyboard or screen-reader user
  // keeps their place on the page instead of starting again from the top.
  const opener = (root.activeElement ?? document.activeElement) as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.className = 'tryon';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', label);
  const layer = document.createElement('div');
  layer.setAttribute('data-tajribah-popup', '');
  const shadow = layer.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = POPUP_STYLE;
  shadow.appendChild(style);
  const sheet = document.createElement('div');
  sheet.className = 'tryon-sheet';
  const frame = document.createElement('iframe');
  frame.src = popupUrl(src);
  frame.title = label;
  frame.allow = 'camera; fullscreen';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tryon-close';
  close.textContent = lang === 'ar' ? 'إغلاق' : 'Close';
  sheet.appendChild(frame);
  sheet.appendChild(close);
  overlay.appendChild(sheet);

  const body = document.body;
  const scroll = body.style.overflow;
  body.style.overflow = 'hidden';
  const origin = new URL(src).origin;
  const onMessage = (event: MessageEvent) => {
    if (isCloseFrom(event, origin, frame.contentWindow)) done();
    // the studio's own close is up: ours, the backup for a frame that never loads, steps aside
    else if (isShownFrom(event, origin, frame.contentWindow)) close.style.display = 'none';
  };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') done(); };
  function done() {
    window.removeEventListener('message', onMessage);
    document.removeEventListener('keydown', onKey);
    body.style.overflow = scroll;
    layer.remove();
    opener?.focus?.();
  }
  close.addEventListener('click', done);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) done(); }); // outside the window
  window.addEventListener('message', onMessage);
  document.addEventListener('keydown', onKey);
  shadow.appendChild(overlay);
  body.appendChild(layer);
  close.focus();
  return done;
}
