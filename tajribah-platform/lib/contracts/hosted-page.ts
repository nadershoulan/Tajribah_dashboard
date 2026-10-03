/**
 * P1.19 — a product's own page: one address a merchant can share anywhere (a post, a message, a
 * bio), showing the product in 3D with "view in your space", and a watch in the try-on. It lives on
 * the website (`tajribah-try-on/app/p/[store]/[product]`) and reads the same published config the
 * shop's button reads — never the database — so it exists exactly while the product is published.
 *
 * What the merchant controls, per product: whether the page is on (on unless switched off — every
 * plan includes it), and the link to buy the product in their own shop, shown on the page.
 */
import { z } from 'zod';

/** The page's address before the short domain (T29: the try-on's site). One setting changes it. */
export const DEFAULT_HOSTED_PAGE_BASE = 'https://tajribah.sa/p';

/** `{base}/{store key}/{product ref}` — the two segments encoded exactly as the config's key is. */
export function hostedPageUrl(base: string, store: string, productRef: string): string {
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(store)}/${encodeURIComponent(productRef)}`;
}

/** An address a shopper may be sent to: https, a real hostname, no user name or password in it. */
export function isShopUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export const HostedPageInput = z.object({
  active: z.boolean(),
  /** Empty or null: no buy link on the page. */
  shopUrl: z.string().trim().max(2048, 'at most 2048 characters').nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isShopUrl(v), 'a link starting with https:// to the product in your shop'),
}).strict();
export type HostedPageInput = z.infer<typeof HostedPageInput>;

export type HostedPageView = {
  /** The page's address — null while the product is not published (the page would say "not available"). */
  url: string | null;
  active: boolean;
  shopUrl: string | null;
};

/**
 * P1.20 — the QR codes screen. A printed code is permanent, so `printable` is true only when the
 * address it carries is final: the store's own address (T62), or a short domain set in
 * `HOSTED_PAGE_BASE`. Otherwise the codes are shown as previews and cannot be downloaded.
 */
export type QrScreen = {
  included: boolean;
  printable: boolean;
  /** Where the codes point: the store's own address, the short domain, or Tajribah's default. */
  base: string;
  products: { id: string; name: string; nameAr: string | null; url: string }[];
};

/** A product page's address as a QR code carries it: tagged, so the visit counts as "from a QR code". */
export const qrUrl = (pageUrl: string): string => `${pageUrl}?s=qr`;

/** The `page` block of a published config (the website reads it; the shop's widget ignores it). */
export type PublishedPage = {
  store: { name: string; nameAr: string | null };
  shopUrl: string | null;
  /** "Made with Tajribah" under the page — off under white-label (Enterprise). */
  poweredBy: boolean;
  /** The store's own address (T62, once active): the page is served there, and there only its store's pages are. */
  host: string | null;
  /** T69: the store's own GA4 measurement id (Store settings): the page loads it only after the shopper agrees. */
  ga4: string | null;
};
