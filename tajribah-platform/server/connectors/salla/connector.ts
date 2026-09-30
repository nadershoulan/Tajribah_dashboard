/**
 * P1.3 / T61 — the Salla connector: a store's catalogue over the Merchant API
 * (`https://api.salla.dev/admin/v2`), built from Salla's public documentation (docs.salla.dev,
 * read 2026-09-30) and tested against a stand-in that answers as those pages describe. A real store
 * confirms or corrects the details once the Salla Partner app exists (P1.4) — the ones taken on
 * trust are marked **(to confirm)**.
 *
 *  - **Tokens**: a bearer access token that lasts 14 days and a refresh token that lasts a month
 *    and works **once** — using it again revokes the access for good (the merchant must reinstall).
 *    `refresh` swaps it at `accounts.salla.sa/oauth2/token` with the app's keys and returns the new
 *    pair; the connection service already refreshes one connection at a time (T8) for this reason.
 *    Salla answers `invalid_grant` (400 or 401) for a refresh token it will not take, and 401 for an
 *    access token that is expired, revoked or whose app was uninstalled: both → `TokenRevokedError`.
 *    `invalid_client` means our own app keys were refused — a setup fault, retried and logged, never
 *    a reason to disconnect a store (the real server's answer, checked 2026-09-30).
 *  - **Names**: one per answer, in the language of `Accept-Language` (Arabic by default). Each page
 *    is read twice — Arabic, then English — and matched by id. The Arabic answer is the Arabic name
 *    when it is written in Arabic (a Latin-only name is not an Arabic name); the English answer is
 *    the name, or the Arabic one when the English page did not have the product.
 *  - **Paging**: `page` and `per_page` (60 at most). The documented `pagination` block is read in
 *    either shape Salla shows (`currentPage`/`totalPages`/`total`, or `current`/`next`). Salla does
 *    not document the order; a product id never changes, so paging holds under edits as long as the
 *    order is by id **(to confirm)** — an edit that moved products between pages would be caught by
 *    the conformance suite against a real store.
 *  - **Changed since**: the Merchant API has no such filter, so an incremental sync reads every page
 *    and keeps the products changed at or after `since` (no total then). Salla's webhooks
 *    (`product.*`) carry changes the moment they happen; this is the safety net.
 *  - **Times**: `updated_at` is "2022-05-26 09:45:09" with no zone — read as Saudi time (UTC+3, no
 *    daylight saving), as Salla's webhook times are stamped **(to confirm)**.
 *  - **Money**: `price.amount` is a JSON number in the product's currency → whole minor units (T5)
 *    through the decimal string, never float arithmetic.
 *  - **Status**: `sale` and `out` (out of stock, still listed) → active; `hidden` → draft;
 *    `deleted` → archived; anything new → draft until looked at.
 */
import { errors } from '../../core/errors/problem';
import { log } from '../../core/observability/log';
import { Transport } from '../transport';
import { TokenRevokedError, type Connector, type ExternalProduct, type Page, type TokenSet } from '../types';
import { htmlToText } from '../woocommerce/html';
import { toMinor } from '../woocommerce/money';

export const SALLA_API = 'https://api.salla.dev/admin/v2';
export const SALLA_ACCOUNTS = 'https://accounts.salla.sa';
/** Salla's documented maximum for `per_page`. */
export const PER_PAGE = 60;

export type SallaApp = { clientId: string; clientSecret: string };

type Money = { amount: number | string; currency: string } | null;
/** A product as the Merchant API returns it — the fields read here. */
export type SallaProduct = {
  id: number;
  name: string;
  description: string | null;
  sku: string | null;
  status: string;
  price: Money;
  images: { url: string; alt?: string | null; type?: string | null }[] | null;
  updated_at: string;
};

type Pagination = { count?: number; total?: number; perPage?: number; currentPage?: number; totalPages?: number; current?: number; next?: string | null; links?: { next?: string | null } };
type ListAnswer = { status: number; success: boolean; data: SallaProduct[]; pagination?: Pagination | null };

const hasArabic = (text: string) => /[؀-ۿ]/.test(text);

/** The transport's per-connection key (rate limit, circuit): a fingerprint of the token, never the token. */
function connectionKey(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 0x01000193);
  return `salla:${(h >>> 0).toString(16)}`;
}

export function statusOf(salla: string): ExternalProduct['status'] {
  if (salla === 'sale' || salla === 'out') return 'active';
  if (salla === 'deleted') return 'archived';
  return 'draft'; // hidden, and anything Salla adds later until it is looked at
}

/** "2022-05-26 09:45:09" in Saudi time (UTC+3); an ISO time with its own zone is read as it says. */
export function timeOf(text: string): Date {
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(text.trim());
  return new Date(local ? `${local[1]}T${local[2]}+03:00` : text);
}

/** The product from its Arabic answer and, when the English page had it, its English one. */
export function toExternal(ar: SallaProduct, en?: SallaProduct): ExternalProduct {
  const arName = ar.name.trim();
  const enName = en?.name?.trim() || arName;
  const currency = (ar.price?.currency || 'SAR').toUpperCase();
  const sku = ar.sku?.trim();
  return {
    externalId: String(ar.id),
    sku: sku ? sku : null,
    name: enName,
    nameAr: hasArabic(arName) ? arName : null,
    description: htmlToText(ar.description ?? ''),
    priceMinor: ar.price ? toMinor(String(ar.price.amount), currency) : null,
    currency,
    images: (ar.images ?? []).flatMap((i) => ((i.type ?? 'image') === 'image' && /^https:\/\//.test(i.url) ? [{ url: i.url, ...(i.alt ? { alt: i.alt } : {}) }] : [])),
    status: statusOf(ar.status),
    updatedAt: timeOf(ar.updated_at),
  };
}

/** The next page number, from either pagination shape Salla documents; null on the last page. */
export function nextPage(pagination: Pagination | null | undefined, page: number): number | null {
  if (!pagination) return null;
  const link = pagination.next ?? pagination.links?.next ?? null;
  if (link) {
    const n = Number(new URL(link).searchParams.get('page'));
    return Number.isSafeInteger(n) && n > page ? n : null;
  }
  const current = pagination.currentPage ?? pagination.current ?? page;
  if (typeof pagination.totalPages === 'number') return current < pagination.totalPages ? current + 1 : null;
  return null;
}

export class SallaConnector implements Connector {
  readonly provider = 'salla' as const;

  constructor(
    /** The Partner app's keys — read when a refresh needs them; null until the app exists. */
    private readonly app: () => SallaApp | null,
    private readonly transport: Transport = new Transport('salla', { rate: { requests: 120, perMs: 60_000 } }),
  ) {}

  private async get<T>(accessToken: string, path: string, lang: 'ar' | 'en'): Promise<{ status: number; body: T | null }> {
    const response = await this.transport.send(connectionKey(accessToken), `${SALLA_API}${path}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', 'accept-language': lang },
    });
    if (response.status === 401) {
      await response.body?.cancel();
      throw new TokenRevokedError('Salla refused the access token (401)');
    }
    if (response.status === 404) {
      await response.body?.cancel();
      return { status: 404, body: null };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw errors.upstream('salla', new Error(`${path.split('?')[0]}: ${response.status}`));
    }
    return { status: response.status, body: await response.json() as T };
  }

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    const app = this.app();
    if (!app) throw errors.notImplemented('Salla stores can be refreshed once the Tajribah Salla app is registered');
    if (!tokens.refreshToken) throw new TokenRevokedError('no Salla refresh token — the store must reinstall the app');
    const response = await this.transport.send('salla-accounts', `${SALLA_ACCOUNTS}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: app.clientId, client_secret: app.clientSecret }).toString(),
    });
    const body = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_in?: number; expires?: number; scope?: string; error?: string } | null;
    // Salla's accounts server answers `invalid_client` (401) when it is *our* app's keys it refuses
    // (seen from the real server, 2026-09-30): a setup fault to fix, never a store to disconnect —
    // treating it as a revocation would wipe every Salla store's tokens at once.
    if (body?.error === 'invalid_client') {
      log.error('Salla refused the app’s own keys — check SALLA_CLIENT_ID / SALLA_CLIENT_SECRET');
      throw errors.upstream('salla', new Error('token refresh: the app keys were refused (invalid_client)'));
    }
    if (body?.error === 'invalid_grant' || response.status === 401) throw new TokenRevokedError('Salla will not take this refresh token — the store must reinstall the app');
    if (!response.ok || !body?.access_token || !body.refresh_token) throw errors.upstream('salla', new Error(`token refresh: ${response.status}`));
    const seconds = body.expires_in ?? body.expires ?? null;
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: typeof seconds === 'number' && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null,
      scopes: body.scope ? body.scope.split(/\s+/).filter(Boolean) : tokens.scopes ?? null,
    };
  }

  async listProducts(accessToken: string, cursor: string | null, since?: Date | null): Promise<Page<ExternalProduct>> {
    const page = cursor === null ? 1 : Number(cursor);
    if (!Number.isSafeInteger(page) || page < 1) throw new Error(`not a Salla page cursor: ${cursor}`);
    const path = `/products?page=${page}&per_page=${PER_PAGE}`;
    const ar = (await this.get<ListAnswer>(accessToken, path, 'ar')).body;
    if (!ar || !Array.isArray(ar.data)) throw errors.upstream('salla', new Error('products: not a list'));
    const en = ar.data.length ? (await this.get<ListAnswer>(accessToken, path, 'en')).body : null;
    const english = new Map((en?.data ?? []).map((p) => [p.id, p]));
    const items = ar.data.map((p) => toExternal(p, english.get(p.id)));
    const next = nextPage(ar.pagination, page);
    const total = !since && typeof ar.pagination?.total === 'number' ? ar.pagination.total : null;
    return { items: since ? items.filter((p) => p.updatedAt.getTime() >= since.getTime()) : items, next: next === null ? null : String(next), total };
  }

  async getProduct(accessToken: string, externalId: string): Promise<ExternalProduct | null> {
    if (!/^\d+$/.test(externalId)) return null; // Salla product ids are numbers
    const ar = await this.get<{ data: SallaProduct }>(accessToken, `/products/${externalId}`, 'ar');
    if (!ar.body?.data) return null;
    const en = await this.get<{ data: SallaProduct }>(accessToken, `/products/${externalId}`, 'en');
    return toExternal(ar.body.data, en.body?.data);
  }
}
