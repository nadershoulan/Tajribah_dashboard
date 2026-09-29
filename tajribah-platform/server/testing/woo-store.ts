/**
 * P6 — a stand-in WooCommerce store for the connector's tests: a `fetch` that answers the REST API
 * (v3) paths the connector uses, the way WooCommerce does — products by id with `page`/`per_page`,
 * `X-WP-Total` and `X-WP-TotalPages`, `modified_after` strictly after, a 404 body for an unknown
 * product, 401 for keys it does not accept, the store currency, and 503 while it is down.
 * Tests only.
 */
import type { ExternalProduct } from '@/server/connectors/types';
import { textToHtml } from '@/server/connectors/woocommerce/html';
import { fromMinor } from '@/server/connectors/woocommerce/money';
import type { WooProduct } from '@/server/connectors/woocommerce/connector';

export const WOO_URL = 'https://shop.example.sa';
export const WOO_CURRENCY = 'SAR';

const gmt = (d: Date) => d.toISOString().slice(0, 19);
const wooStatus = (s: ExternalProduct['status']) => (s === 'active' ? 'publish' : s === 'archived' ? 'private' : 'draft');

/**
 * What a WooCommerce store can hold of a catalogue: numeric ids (in catalogue order), one currency,
 * one name — Arabic when there is an Arabic one, which is then the Arabic name too.
 */
export function wooHolds(catalogue: ExternalProduct[]): ExternalProduct[] {
  return catalogue.map((p, i) => {
    const name = p.nameAr ?? p.name;
    return { ...p, externalId: String(i + 1), name, nameAr: /[؀-ۿ]/.test(name) ? name : null, currency: WOO_CURRENCY };
  });
}

export class WooStore {
  readonly products = new Map<number, WooProduct>();
  readonly keys = new Map<string, string>([['ck_ok', 'cs_ok']]);
  readonly revoked = new Set<string>(['ck_revoked']);
  down = false;
  requests = 0;

  constructor(catalogue: ExternalProduct[] = []) {
    for (const p of wooHolds(catalogue)) this.products.set(Number(p.externalId), WooStore.toWoo(p));
  }

  static toWoo(p: ExternalProduct): WooProduct {
    return {
      id: Number(p.externalId), name: p.name, sku: p.sku ?? '', status: wooStatus(p.status),
      price: p.priceMinor === null ? '' : fromMinor(p.priceMinor, WOO_CURRENCY),
      description: textToHtml(p.description), short_description: '',
      images: p.images.map((i) => ({ src: i.url, alt: i.alt ?? '' })),
      date_modified_gmt: gmt(p.updatedAt),
    };
  }

  /** A merchant edits a product in wp-admin. */
  change(externalId: string, patch: Partial<ExternalProduct>, at: Date): void {
    const current = this.products.get(Number(externalId));
    if (!current) throw new Error(`no product ${externalId}`);
    this.products.set(current.id, { ...current, ...(patch.name ? { name: patch.name } : {}), date_modified_gmt: gmt(at) });
  }

  /** The `fetch` the connector's transport is given. */
  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    this.requests += 1;
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    if (this.down) return new Response('Service Unavailable', { status: 503 });
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    const [key, secret] = atob(auth.replace(/^Basic /, '')).split(':');
    if (url.origin !== WOO_URL || this.revoked.has(key ?? '') || this.keys.get(key ?? '') !== secret) {
      return Response.json({ code: 'woocommerce_rest_cannot_view', message: 'Sorry, you cannot list resources.', data: { status: 401 } }, { status: 401 });
    }
    const path = url.pathname.replace(/^\/wp-json\/wc\/v3/, '');
    if (path === '/data/currencies/current') return Response.json({ code: WOO_CURRENCY, name: 'Saudi riyal', symbol: '&#x631;.&#x633;' });
    const one = /^\/products\/(\d+)$/.exec(path);
    if (one) {
      const product = this.products.get(Number(one[1]));
      return product ? Response.json(product) : Response.json({ code: 'woocommerce_rest_product_invalid_id', message: 'Invalid ID.', data: { status: 404 } }, { status: 404 });
    }
    if (path === '/products') {
      const perPage = Math.min(100, Number(url.searchParams.get('per_page') ?? 10));
      const page = Number(url.searchParams.get('page') ?? 1);
      const after = url.searchParams.get('modified_after');
      const all = [...this.products.values()]
        .filter((p) => !after || new Date(`${p.date_modified_gmt}Z`).getTime() > new Date(after).getTime())
        // As WooCommerce does: the order asked for (its default is newest first by date), ties by id.
        .sort((a, b) => {
          const by = url.searchParams.get('orderby') ?? 'date';
          const key = by === 'id' ? a.id - b.id : by === 'modified' ? a.date_modified_gmt.localeCompare(b.date_modified_gmt) || a.id - b.id : b.id - a.id;
          return by !== 'date' && url.searchParams.get('order') === 'desc' ? -key : key;
        });
      const items = all.slice((page - 1) * perPage, page * perPage);
      return Response.json(items, { headers: { 'x-wp-total': String(all.length), 'x-wp-totalpages': String(Math.max(1, Math.ceil(all.length / perPage))) } });
    }
    return Response.json({ code: 'rest_no_route', message: 'No route was found matching the URL and request method.', data: { status: 404 } }, { status: 404 });
  }) as typeof fetch;
}
