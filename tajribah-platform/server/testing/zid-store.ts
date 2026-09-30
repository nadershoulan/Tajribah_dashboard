/**
 * T61 — a stand-in Zid store for the connector's tests: a `fetch` that answers the Merchant API and the
 * OAuth server the way Zid's public documentation shows (docs.zid.sa, read 2026-09-30) and, for
 * refusals, the way Zid's real servers were seen to answer that day:
 *
 *  - `GET /v1/products/?page&page_size&ordering=created_at` — `{ count, next, previous, results }`
 *    (plus the per-class counts), names and descriptions in both languages, UUID ids, ordered by
 *    creation time; `GET /v1/products/{id}/` — the product itself, or 404;
 *  - every product request needs the bearer, the manager token, the store id and `Role: Manager`;
 *    a token it does not accept → 401 `{"detail":"No such user"}` (the real answer);
 *  - `POST oauth.zid.sa/oauth/token` — `grant_type=refresh_token`: new tokens (`access_token`,
 *    `Authorization`, `refresh_token`, `expires_in`), the old refresh token spent; unknown app keys →
 *    400 "Client authentication failed" (the real answer); a spent or unknown refresh token → 401
 *    `invalid_request` **(to confirm — no real answer seen)**. `grant_type=authorization_code` swaps a
 *    code, once, for the same set;
 *  - `GET /v1/managers/account/profile` — the store (`user.store.id`, `title`) the tokens open;
 *  - 429 with `Retry-After` while throttled, 503 while down.
 * Tests only.
 */
import type { ExternalProduct } from '@/server/connectors/types';
import { textToHtml } from '@/server/connectors/woocommerce/html';
import { fromMinor } from '@/server/connectors/woocommerce/money';
import { ZID_API, ZID_OAUTH, type ZidProduct } from '@/server/connectors/zid/connector';

export const ZID_STORE_ID = '3';
export const ZID_APP = { clientId: '4012', clientSecret: 'zid_test_secret', redirectUri: 'https://app.tajribah.sa/zid/callback' };

const hasArabic = (text: string) => /[؀-ۿ]/.test(text);
const uuidOf = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

/**
 * What a Zid store holds of a catalogue: UUID ids (in catalogue order), one currency (SAR), a price
 * on every product (none → 0) **(to confirm)**, names in both languages (a product without an
 * Arabic name keeps its English one there, which is not an Arabic name), and two statuses — published
 * or not (archived has no separate place: it is unpublished).
 */
export function zidHolds(catalogue: ExternalProduct[]): ExternalProduct[] {
  return catalogue.map((p, i) => ({
    ...p, externalId: uuidOf(i + 1), currency: 'SAR', priceMinor: p.priceMinor ?? 0,
    nameAr: p.nameAr && hasArabic(p.nameAr) ? p.nameAr : null,
    status: p.status === 'active' ? 'active' : 'draft',
  }));
}

type Held = { product: ExternalProduct; createdAt: number };

export class ZidStore {
  readonly products = new Map<string, Held>();
  readonly authorizations = new Set<string>(['zid_auth_ok']);
  readonly managers = new Set<string>(['zid_manager_ok']);
  readonly refreshTokens = new Set<string>(['zid_rt_ok']);
  /** Authorization codes Zid issued, each good once. */
  readonly codes = new Set<string>();
  down = false;
  throttleNext = 0;
  requests = 0;
  storeTitle = 'متجر العود';
  private issued = 0;

  constructor(catalogue: ExternalProduct[] = []) {
    zidHolds(catalogue).forEach((p, i) => this.products.set(p.externalId, { product: p, createdAt: i }));
  }

  toZid(held: Held): ZidProduct & Record<string, unknown> {
    const p = held.product;
    return {
      id: p.externalId, product_class: null, sku: p.sku ?? '', barcode: '', parent_id: null,
      name: { ar: p.nameAr ?? p.name, en: p.name },
      short_description: { ar: textToHtml(p.description), en: '' },
      price: Number(fromMinor(p.priceMinor ?? 0, 'SAR')), sale_price: null, currency: 'SAR', currency_symbol: ' SAR ',
      images: p.images.map((img, n) => ({
        id: `${p.externalId.slice(0, 24)}${String(n).padStart(12, '0')}`,
        image: { full_size: img.url, large: img.url, medium: img.url, small: img.url, thumbnail: img.url },
        alt_text: img.alt ?? '', display_order: n + 1,
      })),
      videos: [], is_draft: false, is_published: p.status === 'active', structure: 'standalone', store_id: Number(ZID_STORE_ID),
      created_at: new Date(Date.UTC(2026, 0, 1) + held.createdAt * 1000).toISOString(),
      updated_at: p.updatedAt.toISOString().replace('.000Z', '.000000Z'),
    };
  }

  /** A merchant edits a product in the Zid dashboard. */
  change(externalId: string, patch: Partial<ExternalProduct>, at: Date): void {
    const held = this.products.get(externalId);
    if (!held) throw new Error(`no product ${externalId}`);
    this.products.set(externalId, { ...held, product: { ...held.product, ...patch, updatedAt: at } });
  }

  private tokens() {
    this.issued += 1;
    const set = { access_token: `zid_manager_${this.issued}`, Authorization: `zid_auth_${this.issued}`, refresh_token: `zid_rt_${this.issued}`, expires_in: 31_536_000, token_type: 'Bearer' };
    this.managers.add(set.access_token); this.authorizations.add(set.Authorization); this.refreshTokens.add(set.refresh_token);
    return set;
  }

  /** The `fetch` the connector's transport is given. */
  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    this.requests += 1;
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    if (this.down) return new Response('Service Unavailable', { status: 503 });
    const headers = new Headers(init?.headers);

    if (url.origin === ZID_OAUTH && url.pathname === '/oauth/token' && init?.method === 'POST') {
      const form = new URLSearchParams(String(init.body));
      if (form.get('client_id') !== ZID_APP.clientId || form.get('client_secret') !== ZID_APP.clientSecret) {
        return Response.json({ status: 'error', message: { type: 'error', code: null, name: null, description: 'Client authentication failed' } }, { status: 400 });
      }
      const refused = () => Response.json({ error: 'invalid_request', error_description: 'The refresh token is invalid.', message: 'The refresh token is invalid.' }, { status: 401 });
      if (form.get('grant_type') === 'refresh_token') {
        const rt = form.get('refresh_token') ?? '';
        if (!this.refreshTokens.delete(rt)) return refused();
        return Response.json(this.tokens());
      }
      if (form.get('grant_type') === 'authorization_code') {
        if (!this.codes.delete(form.get('code') ?? '') || form.get('redirect_uri') !== ZID_APP.redirectUri) return Response.json({ error: 'invalid_grant', error_description: 'The provided authorization grant is invalid.' }, { status: 400 });
        return Response.json(this.tokens());
      }
      return refused();
    }

    const bearer = /^Bearer (.+)$/.exec(headers.get('authorization') ?? '')?.[1] ?? '';
    const manager = headers.get('x-manager-token') ?? headers.get('access-token') ?? '';
    const known = this.authorizations.has(bearer) && this.managers.has(manager);

    if (url.origin === new URL(ZID_API).origin && url.pathname === '/v1/managers/account/profile') {
      if (!known) return Response.json({ status: 'error', message: { type: 'error', code: null, name: null, description: 'Unauthenticated' } }, { status: 401 });
      return Response.json({ status: 'object', user: { id: 51, name: 'Store Owner', email: 'owner@example.sa', store: { id: Number(ZID_STORE_ID), uuid: 'd297fb8b-c322-412e-a2f4-ffa96dc57022', username: this.storeTitle, title: this.storeTitle, url: 'https://oud.zid.store/', currency: { code: 'SAR' } } } });
    }

    if (url.origin !== new URL(ZID_API).origin || !url.pathname.startsWith('/v1/products/') || (init?.method ?? 'GET') !== 'GET') return new Response('Not Found', { status: 404 });
    if (!known || headers.get('store-id') !== ZID_STORE_ID || headers.get('role') !== 'Manager') return Response.json({ detail: 'No such user' }, { status: 401 });
    if (this.throttleNext > 0) {
      this.throttleNext -= 1;
      return Response.json({ detail: 'Request was throttled.' }, { status: 429, headers: { 'retry-after': '1' } });
    }

    const one = /^\/v1\/products\/([0-9a-f-]{36})\/$/.exec(url.pathname);
    if (one) {
      const held = this.products.get(one[1]!);
      return held ? Response.json(this.toZid(held)) : Response.json({ detail: 'Not found.' }, { status: 404 });
    }
    if (url.pathname !== '/v1/products/') return new Response('Not Found', { status: 404 });
    const size = Math.min(100, Number(url.searchParams.get('page_size') ?? 10));
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    if (url.searchParams.get('ordering') !== 'created_at') throw new Error('the stand-in pages by creation time only, as the connector asks');
    const all = [...this.products.values()].sort((a, b) => a.createdAt - b.createdAt);
    const slice = all.slice((page - 1) * size, page * size);
    const link = (n: number) => `http://api.zid.sa/v1/products/?ordering=created_at&page=${n}&page_size=${size}`;
    return Response.json({
      total_products_count: all.length, normal_products_count: all.length, voucher_products_count: 0, grouped_products_count: 0,
      downloadable_products_count: 0, dynamic_bundle_products_count: 0, donation_item_count: 0, crowd_funding_count: 0,
      next: page * size < all.length ? link(page + 1) : null, previous: page > 1 ? link(page - 1) : null,
      count: all.length, results: slice.map((h) => this.toZid(h)),
    });
  }) as typeof fetch;
}
