/**
 * T61 — the Zid connector: a store's catalogue over Zid's Merchant API (`https://api.zid.sa/v1`),
 * built from Zid's public documentation (docs.zid.sa, read 2026-09-30) and tested against a stand-in
 * that answers as those pages describe. A real store confirms or corrects the details once the Zid
 * Partner app exists — the ones taken on trust are marked **(to confirm)**.
 *
 *  - **Credentials** come in three parts, kept together as the connection's sealed access token
 *    (`zidToken`): the app's `Authorization` token for that store (sent as a bearer), the store's
 *    manager token (`X-Manager-Token`, which the product endpoints call `Access-Token` — Zid says they
 *    are the same), and the store's id (`Store-Id`). Both tokens last a year; `refresh` swaps the
 *    refresh token for new ones at `oauth.zid.sa/oauth/token` with the app's keys.
 *  - **Refusals**, as Zid's real servers answer them (checked 2026-09-30): the product API answers 401
 *    `{"detail":"No such user"}` to tokens it does not accept → `TokenRevokedError`; the OAuth server
 *    answers 400 "Client authentication failed" to *our* unknown app keys — a setup fault, logged and
 *    retried, never a store disconnected. Any other refusal of a refresh token → `TokenRevokedError`.
 *  - **Names and descriptions** arrive in both languages at once (`{ ar, en }` — a manager's answer
 *    always carries both). The Arabic name is the Arabic name when it is written in Arabic.
 *  - **Paging**: `page` and `page_size` (50 **(to confirm)** — the docs give no maximum), ordered by
 *    creation time (`ordering=created_at`, as Zid recommends for a full sync): an edit never moves a
 *    product between pages. `next` is the following page's address; `count` the total.
 *  - **Changed since**: the list has no such filter, so an incremental sync reads every page and keeps
 *    the products changed at or after `since` (no total then). Zid's webhooks carry changes at once.
 *  - **Which products**: the list is asked without `is_published`, to include unpublished products —
 *    whether Zid then lists them **(to confirm)**; unpublished or draft → `draft`.
 *  - **Money**: the price a shopper pays — `sale_price` when there is one, else `price` — a JSON
 *    number in the store's currency, to whole minor units through the decimal string.
 *  - **Rate**: 60 requests a minute per app per store (Zid's published limit).
 */
import { errors } from '../../core/errors/problem';
import { log } from '../../core/observability/log';
import { Transport } from '../transport';
import { TokenRevokedError, type Connector, type ExternalProduct, type Page, type TokenSet } from '../types';
import { htmlToText } from '../woocommerce/html';
import { toMinor } from '../woocommerce/money';

export const ZID_API = 'https://api.zid.sa/v1';
export const ZID_OAUTH = 'https://oauth.zid.sa';
export const PER_PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ZidApp = { clientId: string; clientSecret: string; redirectUri: string };
export type ZidCredentials = { authorization: string; manager: string; storeId: string };

/** The access token a Zid connection stores (sealed): the two tokens and the store they open. */
export const zidToken = (credentials: ZidCredentials): string => JSON.stringify(credentials);

export function zidCredentials(accessToken: string): ZidCredentials {
  let parsed: unknown;
  try { parsed = JSON.parse(accessToken); } catch { throw new TokenRevokedError('not a Zid access token'); }
  const c = parsed as Partial<ZidCredentials>;
  if (typeof c.authorization !== 'string' || !c.authorization || typeof c.manager !== 'string' || !c.manager || typeof c.storeId !== 'string' || !/^\d{1,19}$/.test(c.storeId)) {
    throw new TokenRevokedError('not a Zid access token');
  }
  return { authorization: c.authorization, manager: c.manager, storeId: c.storeId };
}

type Bi = { ar?: string | null; en?: string | null } | string | null | undefined;
/** A product as the Merchant API returns it — the fields read here. */
export type ZidProduct = {
  id: string;
  sku: string | null;
  name: Bi;
  short_description?: Bi;
  price: number | string | null;
  sale_price: number | string | null;
  currency: string | null;
  images: { image?: { full_size?: string | null } | null; alt_text?: string | null }[] | null;
  is_published: boolean;
  is_draft?: boolean;
  updated_at: string;
};

type ListAnswer = { count?: number; next?: string | null; results?: ZidProduct[] };

const hasArabic = (text: string) => /[؀-ۿ]/.test(text);
const text = (v: Bi, lang: 'ar' | 'en'): string => (typeof v === 'string' ? v : (v?.[lang] ?? '')).trim();

export function statusOf(p: Pick<ZidProduct, 'is_published' | 'is_draft'>): ExternalProduct['status'] {
  return p.is_published && !p.is_draft ? 'active' : 'draft';
}

export function toExternal(p: ZidProduct): ExternalProduct {
  const ar = text(p.name, 'ar');
  const en = text(p.name, 'en');
  const currency = (p.currency || 'SAR').toUpperCase();
  const pays = p.sale_price !== null && p.sale_price !== undefined && p.sale_price !== '' ? p.sale_price : p.price;
  const sku = p.sku?.trim();
  return {
    externalId: p.id,
    sku: sku ? sku : null,
    name: en || ar,
    nameAr: hasArabic(ar) ? ar : null,
    description: htmlToText(text(p.short_description, 'ar') || text(p.short_description, 'en')),
    priceMinor: pays === null || pays === undefined ? null : toMinor(String(pays), currency),
    currency,
    images: (p.images ?? []).flatMap((i) => {
      const url = i.image?.full_size ?? '';
      return /^https:\/\//.test(url) ? [{ url, ...(i.alt_text ? { alt: i.alt_text } : {}) }] : [];
    }),
    status: statusOf(p),
    updatedAt: new Date(p.updated_at),
  };
}

/** The page after `page`, read from Zid's `next` address; null on the last page. */
export function nextPage(next: string | null | undefined, page: number): number | null {
  if (!next) return null;
  try {
    const n = Number(new URL(next).searchParams.get('page'));
    return Number.isSafeInteger(n) && n > page ? n : null;
  } catch { return null; }
}

/** What Zid's OAuth server says, in either shape it uses: `{ error }`, or `{ status, message: { description } }`. */
function oauthProblem(body: unknown): string {
  const b = body as { error?: unknown; error_description?: unknown; message?: { description?: unknown } } | null;
  return [b?.error, b?.error_description, b?.message?.description].filter((v) => typeof v === 'string').join(' ');
}

export class ZidConnector implements Connector {
  readonly provider = 'zid' as const;

  constructor(
    /** The Partner app's keys — read when a refresh needs them; null until the app exists. */
    private readonly app: () => ZidApp | null,
    private readonly transport: Transport = new Transport('zid', { rate: { requests: 60, perMs: 60_000 } }),
  ) {}

  private async get<T>(c: ZidCredentials, path: string): Promise<T | null> {
    const response = await this.transport.send(`zid:${c.storeId}`, `${ZID_API}${path}`, {
      headers: {
        authorization: `Bearer ${c.authorization}`, 'x-manager-token': c.manager, 'access-token': c.manager,
        'store-id': c.storeId, role: 'Manager', 'accept-language': 'all-languages', accept: 'application/json',
      },
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new TokenRevokedError(`Zid refused the store's tokens (${response.status})`);
    }
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw errors.upstream('zid', new Error(`${path.split('?')[0]}: ${response.status}`));
    }
    return await response.json() as T;
  }

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    const app = this.app();
    if (!app) throw errors.notImplemented('Zid stores can be refreshed once the Tajribah Zid app is registered');
    const c = zidCredentials(tokens.accessToken);
    if (!tokens.refreshToken) throw new TokenRevokedError('no Zid refresh token — the store must reconnect');
    const response = await this.transport.send('zid-oauth', `${ZID_OAUTH}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectUri }).toString(),
    });
    const body = await response.json().catch(() => null) as { access_token?: string; Authorization?: string; authorization?: string; refresh_token?: string; expires_in?: number } | null;
    const problem = oauthProblem(body);
    if (/client authentication failed|invalid_client/i.test(problem)) {
      log.error('Zid refused the app’s own keys — check ZID_CLIENT_ID / ZID_CLIENT_SECRET');
      throw errors.upstream('zid', new Error('token refresh: the app keys were refused'));
    }
    if (response.status >= 500) throw errors.upstream('zid', new Error(`token refresh: ${response.status}`));
    const authorization = body?.Authorization ?? body?.authorization;
    if (!response.ok || !body?.access_token || !authorization || !body.refresh_token) throw new TokenRevokedError(`Zid will not take this refresh token${problem ? ` (${problem})` : ''} — the store must reconnect`);
    return {
      accessToken: zidToken({ authorization, manager: body.access_token, storeId: c.storeId }),
      refreshToken: body.refresh_token,
      expiresAt: typeof body.expires_in === 'number' && body.expires_in > 0 ? new Date(Date.now() + body.expires_in * 1000) : null,
      scopes: tokens.scopes ?? null,
    };
  }

  async listProducts(accessToken: string, cursor: string | null, since?: Date | null): Promise<Page<ExternalProduct>> {
    const c = zidCredentials(accessToken);
    const page = cursor === null ? 1 : Number(cursor);
    if (!Number.isSafeInteger(page) || page < 1) throw new Error(`not a Zid page cursor: ${cursor}`);
    const answer = await this.get<ListAnswer>(c, `/products/?page=${page}&page_size=${PER_PAGE}&ordering=created_at`);
    if (!answer || !Array.isArray(answer.results)) throw errors.upstream('zid', new Error('products: not a list'));
    const items = answer.results.map(toExternal);
    const next = nextPage(answer.next, page);
    return {
      items: since ? items.filter((p) => p.updatedAt.getTime() >= since.getTime()) : items,
      next: next === null ? null : String(next),
      total: !since && typeof answer.count === 'number' ? answer.count : null,
    };
  }

  async getProduct(accessToken: string, externalId: string): Promise<ExternalProduct | null> {
    if (!UUID.test(externalId)) return null; // Zid product ids are UUIDs
    const c = zidCredentials(accessToken);
    const product = await this.get<ZidProduct>(c, `/products/${externalId}/`);
    return product ? toExternal(product) : null;
  }
}
