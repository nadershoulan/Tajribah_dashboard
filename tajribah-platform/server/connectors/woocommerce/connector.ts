/**
 * P6 — the WooCommerce connector: a store's catalogue over the WooCommerce REST API (v3), with the
 * read-only keys its owner approves on their own site (`/wc-auth/v1/authorize`, scope `read`). No
 * partner account: WooCommerce is self-hosted, and each store grants access itself.
 *
 *  - **Credentials** are the store's address and its key pair, kept together as the connection's
 *    sealed access token (`wooToken`). Keys do not expire: `refresh` checks they are still accepted —
 *    a 401 or 403 means the owner revoked them, and only reconnecting helps.
 *  - **Paging** by product id, oldest first, 100 a page: an edit never moves a product between
 *    pages, so a sync that resumes from a stored cursor misses nothing and lists nothing twice.
 *  - **Changed since**: `modified_after` is strictly after, so it is asked one second earlier —
 *    the engine expects "at or after" and tolerates the overlap.
 *  - **What WooCommerce cannot say**: one currency per store (read once, then remembered for ten
 *    minutes); one name (Arabic when the store writes it in Arabic — then it is the Arabic name
 *    too); no "archived" (a **private** product is hidden from the shop, so it is archived here).
 *  - **Money** is converted exactly in the currency's own minor unit (`money.ts`).
 *  - Every call goes through the shared `Transport` (timeouts, retries, circuit, rate limit); a
 *    store that cannot answer throws `upstream_*`, never an empty page.
 */
import { errors } from '../../core/errors/problem';
import { Transport } from '../transport';
import { TokenRevokedError, type Connector, type ExternalProduct, type Page, type TokenSet } from '../types';
import { decodeEntities, htmlToText } from './html';
import { toMinor } from './money';

export type WooCredentials = { url: string; key: string; secret: string };

/** The access token a WooCommerce connection stores (sealed): its address and key pair. */
export const wooToken = (credentials: WooCredentials): string => JSON.stringify(credentials);

export function wooCredentials(accessToken: string): WooCredentials {
  let parsed: unknown;
  try { parsed = JSON.parse(accessToken); } catch { throw new TokenRevokedError('not a WooCommerce access token'); }
  const c = parsed as Partial<WooCredentials>;
  if (typeof c.url !== 'string' || typeof c.key !== 'string' || typeof c.secret !== 'string') throw new TokenRevokedError('not a WooCommerce access token');
  return { url: c.url.replace(/\/+$/, ''), key: c.key, secret: c.secret };
}

/** A product as the WooCommerce REST API returns it — the fields read here. */
export type WooProduct = {
  id: number; name: string; sku: string; status: string; price: string;
  description: string; short_description?: string;
  images: { src: string; alt?: string }[];
  date_modified_gmt: string;
};

const PER_PAGE = 100;
const CURRENCY_TTL_MS = 10 * 60_000;
const hasArabic = (text: string) => /[؀-ۿ]/.test(text);

export function statusOf(woo: string): ExternalProduct['status'] {
  if (woo === 'publish') return 'active';
  if (woo === 'private') return 'archived';
  return 'draft'; // draft, pending, future
}

export function toExternal(p: WooProduct, currency: string): ExternalProduct {
  const name = decodeEntities(p.name).trim();
  return {
    externalId: String(p.id),
    sku: p.sku ? p.sku : null,
    name,
    nameAr: hasArabic(name) ? name : null,
    description: htmlToText(p.description) ?? htmlToText(p.short_description ?? null),
    priceMinor: toMinor(p.price, currency),
    currency,
    images: (p.images ?? []).filter((i) => /^https:\/\//.test(i.src)).map((i) => ({ url: i.src, ...(i.alt ? { alt: i.alt } : {}) })),
    status: statusOf(p.status),
    updatedAt: new Date(`${p.date_modified_gmt}Z`),
  };
}

export class WooCommerceConnector implements Connector {
  readonly provider = 'woocommerce' as const;
  private readonly currencies = new Map<string, { code: string; at: number }>();

  constructor(private readonly transport: Transport = new Transport('woocommerce'), private readonly now: () => number = Date.now) {}

  private async get(c: WooCredentials, path: string, params: Record<string, string> = {}): Promise<Response> {
    const url = new URL(`${c.url}/wp-json/wc/v3${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const response = await this.transport.send(new URL(c.url).host, url.toString(), {
      headers: { authorization: `Basic ${btoa(`${c.key}:${c.secret}`)}`, accept: 'application/json' },
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new TokenRevokedError(`WooCommerce refused the keys (${response.status})`);
    }
    return response;
  }

  private async json<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) {
      await response.body?.cancel();
      throw errors.upstream('woocommerce', new Error(`${what}: ${response.status}`));
    }
    return await response.json() as T;
  }

  private async currencyOf(c: WooCredentials): Promise<string> {
    const cached = this.currencies.get(c.url);
    if (cached && this.now() - cached.at < CURRENCY_TTL_MS) return cached.code;
    const body = await this.json<{ code?: string }>(await this.get(c, '/data/currencies/current'), 'currency');
    const code = typeof body.code === 'string' && /^[A-Z]{3}$/.test(body.code) ? body.code : null;
    if (!code) throw errors.upstream('woocommerce', new Error('the store did not say its currency'));
    this.currencies.set(c.url, { code, at: this.now() });
    return code;
  }

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    const c = wooCredentials(tokens.accessToken);
    await this.json(await this.get(c, '/products', { per_page: '1' }), 'check keys');
    return { accessToken: tokens.accessToken, refreshToken: null, expiresAt: null, scopes: tokens.scopes ?? ['read'] };
  }

  async listProducts(accessToken: string, cursor: string | null, since?: Date | null): Promise<Page<ExternalProduct>> {
    const c = wooCredentials(accessToken);
    const page = cursor ? Number(cursor) : 1;
    if (!Number.isSafeInteger(page) || page < 1) throw errors.validation({ cursor: ['not a WooCommerce page'] });
    const params: Record<string, string> = { per_page: String(PER_PAGE), page: String(page), orderby: 'id', order: 'asc', status: 'any' };
    if (since) { params.modified_after = new Date(since.getTime() - 1000).toISOString(); params.dates_are_gmt = 'true'; }
    const currency = await this.currencyOf(c);
    const response = await this.get(c, '/products', params);
    const totalPages = Number(response.headers.get('x-wp-totalpages'));
    const total = response.headers.get('x-wp-total');
    const products = await this.json<WooProduct[]>(response, 'products');
    if (!Array.isArray(products)) throw errors.upstream('woocommerce', new Error('products: not a list'));
    const more = Number.isFinite(totalPages) && totalPages > 0 ? page < totalPages : products.length === PER_PAGE;
    return { items: products.map((p) => toExternal(p, currency)), next: more ? String(page + 1) : null, total: total === null ? null : Number(total) };
  }

  async getProduct(accessToken: string, externalId: string): Promise<ExternalProduct | null> {
    if (!/^\d+$/.test(externalId)) return null; // WooCommerce ids are numbers
    const c = wooCredentials(accessToken);
    const currency = await this.currencyOf(c);
    const response = await this.get(c, `/products/${externalId}`);
    if (response.status === 404) { await response.body?.cancel(); return null; }
    return toExternal(await this.json<WooProduct>(response, 'product'), currency);
  }
}
