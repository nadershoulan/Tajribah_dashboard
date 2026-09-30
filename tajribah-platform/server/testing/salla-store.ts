/**
 * T61 — a stand-in Salla store for the connector's tests: a `fetch` that answers the Merchant API and
 * the accounts server the way Salla's public documentation shows (docs.salla.dev, read 2026-09-30):
 *
 *  - `GET /admin/v2/products?page&per_page` — `{ status, success, data, pagination }` with the
 *    documented pagination block (`count, total, perPage, currentPage, totalPages, links`), 60 a page
 *    at most, one name per answer in the `Accept-Language` language (Arabic by default), ordered by
 *    id; `GET /admin/v2/products/{id}` — the product, or 404 with Salla's error envelope;
 *  - 401 `Unauthorized` for an access token it does not accept (expired, revoked, uninstalled);
 *    `invalid_client` for app keys it does not know;
 *  - `POST accounts.salla.sa/oauth2/token` (`grant_type=refresh_token`) — a new pair, the old
 *    refresh token spent; a spent one used again answers `invalid_grant` and revokes the whole
 *    family, as Salla warns;
 *  - `GET accounts.salla.sa/oauth2/user/info` — the merchant (store) the token belongs to;
 *  - `POST api.salla.dev/exchange-authority/v1/introspect` — the store an app page's session token
 *    belongs to, for the app id in `s-source` only (422 "Decryption failed" otherwise — the real
 *    server's status; the docs show 401);
 *  - 429 with `Retry-After` while throttled, 503 while down.
 * Tests only.
 */
import type { ExternalProduct } from '@/server/connectors/types';
import { textToHtml } from '@/server/connectors/woocommerce/html';
import { fromMinor } from '@/server/connectors/woocommerce/money';
import { SALLA_ACCOUNTS, SALLA_API, type SallaProduct } from '@/server/connectors/salla/connector';

export const SALLA_MERCHANT = 847769313;
export const SALLA_APP = { clientId: 'tajribah-salla-test', clientSecret: 'salla_test_secret' };
export const SALLA_APP_ID = '1180704399';

const hasArabic = (text: string) => /[؀-ۿ]/.test(text);

/**
 * What a Salla store holds of a catalogue: numeric ids (in catalogue order), one currency (SAR), a
 * price on every product (none → 0) **(to confirm)**, and names by language — Arabic is the store's
 * default, so a product without an Arabic name shows its English one there, which is then not an
 * Arabic name.
 */
export function sallaHolds(catalogue: ExternalProduct[]): ExternalProduct[] {
  return catalogue.map((p, i) => ({
    ...p, externalId: String(700_000_000 + i), currency: 'SAR', priceMinor: p.priceMinor ?? 0,
    nameAr: p.nameAr && hasArabic(p.nameAr) ? p.nameAr : null,
  }));
}

/** Saudi time, as Salla writes `updated_at`: "2026-09-01 12:00:00" (UTC+3). */
export const sallaTime = (at: Date) => new Date(at.getTime() + 3 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');

const SALLA_STATUS: Record<ExternalProduct['status'], string> = { active: 'sale', draft: 'hidden', archived: 'deleted' };

type Held = { ar: string; en: string; product: ExternalProduct };

export class SallaStore {
  readonly products = new Map<number, Held>();
  readonly accessTokens = new Set<string>(['salla_at_ok']);
  /** Refresh token → the access token it was issued with; spent ones are remembered. */
  readonly refreshTokens = new Map<string, string>([['salla_rt_ok', 'salla_at_ok']]);
  readonly spent = new Set<string>();
  down = false;
  /** Answer this many API requests with 429 before serving again. */
  throttleNext = 0;
  requests = 0;
  readonly languages: string[] = [];
  /** App-page session tokens Salla issued: token → the store (merchant id) it belongs to. */
  readonly sessions = new Map<string, number>([['em_tok_ok', SALLA_MERCHANT]]);
  /** The store the access tokens open (user info). */
  merchant = SALLA_MERCHANT;
  private issued = 0;

  constructor(catalogue: ExternalProduct[] = []) {
    for (const p of sallaHolds(catalogue)) this.products.set(Number(p.externalId), { ar: p.nameAr ?? p.name, en: p.name, product: p });
  }

  toSalla(id: number, lang: 'ar' | 'en'): SallaProduct & Record<string, unknown> {
    const { ar, en, product: p } = this.products.get(id)!;
    return {
      id, name: lang === 'en' ? en : ar, sku: p.sku ?? '', mpn: null, gtin: null, type: 'product',
      description: textToHtml(p.description) ?? '', status: SALLA_STATUS[p.status],
      price: { amount: Number(fromMinor(p.priceMinor ?? 0, 'SAR')), currency: 'SAR' },
      sale_price: { amount: 0, currency: 'SAR' },
      images: [
        ...p.images.map((img, n) => ({ id: id * 10 + n, url: img.url, main: n === 0, three_d_image_url: '', alt: img.alt ?? '', video_url: '', type: 'image', sort: n })),
        // A video among the images, as Salla lists them.
        { id: id * 10 + 9, url: 'https://cdn.salla.sa/video-cover.jpg', main: false, three_d_image_url: '', alt: '', video_url: 'https://youtu.be/x', type: 'video', sort: 99 },
      ],
      updated_at: sallaTime(p.updatedAt),
    };
  }

  /** A merchant edits a product in the Salla dashboard. */
  change(externalId: string, patch: Partial<ExternalProduct>, at: Date): void {
    const held = this.products.get(Number(externalId));
    if (!held) throw new Error(`no product ${externalId}`);
    this.products.set(Number(externalId), {
      ...held, ...(patch.name ? { en: patch.name } : {}), ...(patch.nameAr ? { ar: patch.nameAr } : {}),
      product: { ...held.product, ...patch, updatedAt: at },
    });
  }

  /** The `fetch` the connector's transport is given. */
  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    this.requests += 1;
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    if (this.down) return new Response('Service Unavailable', { status: 503 });
    const headers = new Headers(init?.headers);

    if (`${url.origin}` === SALLA_ACCOUNTS && url.pathname === '/oauth2/token' && init?.method === 'POST') {
      const form = new URLSearchParams(String(init.body));
      const refresh = form.get('refresh_token') ?? '';
      const invalid = () => Response.json({ error: 'invalid_grant', error_description: 'The provided authorization grant (e.g., authorization code, resource owner credentials) or refresh token is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.' }, { status: 401 });
      // What the real server answers to keys it does not know (checked 2026-09-30).
      if (form.get('client_id') !== SALLA_APP.clientId || form.get('client_secret') !== SALLA_APP.clientSecret) return Response.json({ error: 'invalid_client', error_description: 'Client authentication failed (e.g., unknown client, no client authentication included, or unsupported authentication method). Unable to locate the resource' }, { status: 401 });
      if (form.get('grant_type') !== 'refresh_token') return invalid();
      if (this.spent.has(refresh)) {
        // Used twice: the whole family is revoked — only a reinstall brings access back.
        for (const [rt, at] of this.refreshTokens) { this.refreshTokens.delete(rt); this.accessTokens.delete(at); }
        return invalid();
      }
      const old = this.refreshTokens.get(refresh);
      if (old === undefined) return invalid();
      this.refreshTokens.delete(refresh);
      this.spent.add(refresh);
      this.accessTokens.delete(old);
      this.issued += 1;
      const pair = { access_token: `salla_at_${this.issued}`, refresh_token: `salla_rt_${this.issued}` };
      this.accessTokens.add(pair.access_token);
      this.refreshTokens.set(pair.refresh_token, pair.access_token);
      return Response.json({ ...pair, expires_in: 1_209_599, scope: 'settings.read products.read offline_access', token_type: 'bearer' });
    }

    if (url.href === 'https://api.salla.dev/exchange-authority/v1/introspect' && init?.method === 'POST') {
      const { token: session } = JSON.parse(String(init.body)) as { token?: string };
      const merchant = this.sessions.get(session ?? '');
      // 422, not the 401 the docs show: what the real server answers (checked 2026-09-30).
      if (headers.get('s-source') !== SALLA_APP_ID || merchant === undefined) return Response.json({ status: 422, success: false, error: { message: 'Decryption failed', code: 0 } }, { status: 422 });
      return Response.json({ status: 200, success: true, data: { merchant_id: merchant, user_id: 987654, exp: new Date(Date.now() + 600_000).toISOString() } });
    }

    const token = /^Bearer (.+)$/.exec(headers.get('authorization') ?? '')?.[1] ?? '';
    const unauthorized = () => Response.json({ status: 401, success: false, error: { code: 'Unauthorized', message: 'The access token is invalid' } }, { status: 401 });

    if (`${url.origin}` === SALLA_ACCOUNTS && url.pathname === '/oauth2/user/info') {
      if (!this.accessTokens.has(token)) return unauthorized();
      return Response.json({
        status: 200, success: true,
        data: { id: 1689171978, name: 'Store Owner', email: 'owner@example.sa', role: 'user', merchant: { id: this.merchant, username: 'oud-house', name: 'بيت العود', avatar: 'https://cdn.salla.sa/oud-house/logo.png', plan: 'pro', status: 'active', domain: 'https://oud-house.example.sa' } },
      });
    }

    const api = new URL(SALLA_API);
    if (url.origin !== api.origin || !url.pathname.startsWith(`${api.pathname}/products`) || (init?.method ?? 'GET') !== 'GET') return new Response('Not Found', { status: 404 });
    if (!this.accessTokens.has(token)) return unauthorized();
    if (this.throttleNext > 0) {
      this.throttleNext -= 1;
      return Response.json({ status: 429, success: false, error: { code: 'too_many_requests', message: 'Too Many Attempts.' } }, { status: 429, headers: { 'retry-after': '1', 'x-ratelimit-limit': '120', 'x-ratelimit-remaining': '0' } });
    }
    const lang = headers.get('accept-language') === 'en' ? 'en' : 'ar';
    this.languages.push(lang);

    const one = /^\/admin\/v2\/products\/(\d+)$/.exec(url.pathname);
    if (one) {
      const id = Number(one[1]);
      if (!this.products.has(id)) return Response.json({ status: 404, success: false, error: { code: 'not_found', message: 'المنتج غير موجود' } }, { status: 404 });
      return Response.json({ status: 200, success: true, data: this.toSalla(id, lang) });
    }
    if (url.pathname !== '/admin/v2/products') return new Response('Not Found', { status: 404 });
    const perPage = Math.min(60, Number(url.searchParams.get('per_page') ?? 15));
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const ids = [...this.products.keys()].sort((a, b) => a - b);
    const slice = ids.slice((page - 1) * perPage, page * perPage);
    const totalPages = Math.max(1, Math.ceil(ids.length / perPage));
    const link = (n: number) => `${SALLA_API}/products?page=${n}&per_page=${perPage}`;
    return Response.json({
      status: 200, success: true,
      data: slice.map((id) => this.toSalla(id, lang)),
      pagination: {
        count: slice.length, total: ids.length, perPage, currentPage: page, totalPages,
        links: { ...(page < totalPages ? { next: link(page + 1) } : {}), ...(page > 1 ? { previous: link(page - 1) } : {}) },
      },
    });
  }) as typeof fetch;
}
