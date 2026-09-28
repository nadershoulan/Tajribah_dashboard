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
export const DEFAULT_TRYON = 'https://tajribah.com/embed/try-on';
/** What the frame posts when the shopper closes it. Only the frame's own origin is listened to. */
export const CLOSE_MESSAGE = 'tajribah:tryon:close';

/** The frame's address for one product. */
export function tryOnUrl(base: string, store: string, product: string, lang: 'ar' | 'en'): string {
  const url = new URL(base);
  url.searchParams.set('store', store);
  url.searchParams.set('product', product);
  url.searchParams.set('lang', lang);
  return url.href;
}

/** A close from our frame — never from the shop page or another frame. */
export function isCloseFrom(event: { origin: string; data: unknown; source: unknown }, frameOrigin: string, frameWindow: unknown): boolean {
  return event.origin === frameOrigin && event.source === frameWindow
    && typeof event.data === 'object' && event.data !== null && (event.data as { type?: unknown }).type === CLOSE_MESSAGE;
}

/**
 * Open the frame as a full-screen dialog in the widget's shadow root. Escape, our close button or
 * the frame's own close message remove it and give the page its scroll back.
 */
export function openTryOn(root: ShadowRoot, src: string, lang: 'ar' | 'en', label: string): () => void {
  const overlay = document.createElement('div');
  overlay.className = 'tryon';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', label);
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.title = label;
  frame.allow = 'camera; fullscreen';
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tryon-close';
  close.textContent = lang === 'ar' ? 'إغلاق' : 'Close';
  overlay.appendChild(frame);
  overlay.appendChild(close);

  const body = document.body;
  const scroll = body.style.overflow;
  body.style.overflow = 'hidden';
  const origin = new URL(src).origin;
  const onMessage = (event: MessageEvent) => { if (isCloseFrom(event, origin, frame.contentWindow)) done(); };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') done(); };
  function done() {
    window.removeEventListener('message', onMessage);
    document.removeEventListener('keydown', onKey);
    body.style.overflow = scroll;
    overlay.remove();
  }
  close.addEventListener('click', done);
  window.addEventListener('message', onMessage);
  document.addEventListener('keydown', onKey);
  root.appendChild(overlay);
  close.focus();
  return done;
}
