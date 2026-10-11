/**
 * T137 — share a try-on picture through the phone's own sheet, or save it as a file. A phone lets the share sheet open
 * only straight from the tap: anything waited for first (loading a picture, encoding it) and Safari or Chrome refuse
 * it — which is why sharing failed on a phone. So the picture is made at once (`toDataURL`, `dataUrlBlob`) and the
 * share starts inside the tap; whatever cannot share saves the file instead.
 */

/** A data URL as a Blob, at once (no waiting). */
export function dataUrlBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(5, comma); // after "data:"
  const type = head.split(';')[0] || 'application/octet-stream';
  const body = dataUrl.slice(comma + 1);
  if (!/;base64$/.test(head)) return new Blob([decodeURIComponent(body)], { type });
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Save the picture as a file (a computer, or a phone that cannot share files). */
export function savePicture(file: File): 'saved' {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  return 'saved';
}

/** What goes with the picture: the product's name, a line inviting others to try it, and the link to it. */
export type ShareDetails = { title?: string; text?: string; url?: string | null };

/**
 * T137 (Nader): a share is an invitation — «{the product} — جرّبها عليك من هنا: {link}» — so whoever receives the
 * picture can open the product and try it themselves. The link is also in the text: some apps keep only the text.
 */
export function inviteText(name: string, link: string | null | undefined, ar: boolean): string {
  const line = ar ? `${name} — جرّبها عليك من هنا` : `${name} — try it on here`;
  return link ? `${line}: ${link}` : name;
}

/** Call straight from the tap: the share sheet opens at once; refused or unsupported, the file is saved instead. */
export function sharePicture(file: File, details: ShareDetails = {}): Promise<'shared' | 'saved' | 'cancelled'> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const extra = { ...(details.title ? { title: details.title } : {}), ...(details.text ? { text: details.text } : {}), ...(details.url && !details.text?.includes(details.url) ? { url: details.url } : {}) };
  if (nav?.canShare?.({ files: [file] }) && nav.share) {
    return nav.share({ files: [file], ...extra }).then(
      () => 'shared' as const,
      (e: unknown) => (e instanceof DOMException && e.name === 'AbortError' ? ('cancelled' as const) : savePicture(file)),
    );
  }
  return Promise.resolve(savePicture(file));
}

/**
 * The address a shared picture invites people to (T137): the store's own product page the window is over, when the
 * widget said so (`from`) and the browser agrees it came from that site (the referrer) — else the product's try-on page
 * on Tajribah, `/p/{store}/{product}`. Nothing in the dashboard's preview (no shopper is sharing).
 */
export function shareLinkOf(query: URLSearchParams, referrer: string, origin: string): string | null {
  if (query.get('preview')) return null;
  const from = query.get('from');
  try {
    if (from && referrer && /^https:\/\//.test(from) && new URL(from).origin === new URL(referrer).origin) return from;
  } catch { /* not addresses */ }
  const store = query.get('store'), product = query.get('product');
  return store && product ? `${origin}/p/${encodeURIComponent(store)}/${encodeURIComponent(product)}` : null;
}

/** The link a picture shares: the one given, none when given none (`null` — the dashboard's preview), this page when not given. */
export const linkOrHere = (link: string | null | undefined): string | null =>
  link !== undefined ? link : typeof location === 'undefined' ? null : location.href.split('#')[0]!;

