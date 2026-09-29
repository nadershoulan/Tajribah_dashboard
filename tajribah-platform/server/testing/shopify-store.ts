/**
 * P6 — a stand-in Shopify store for the connector's tests: a `fetch` that answers the GraphQL Admin
 * API operations the connector sends, the way Shopify does — products by id with opaque cursors,
 * the `updated_at:>=` search, `productsCount` with its precision, a null product for an unknown id,
 * 401 for a token it does not accept, `THROTTLED` inside a 200 while its bucket is empty, and 503
 * while it is down. It does not parse GraphQL: it reads the operation name. Tests only.
 */
import type { ExternalProduct } from '@/server/connectors/types';
import { textToHtml } from '@/server/connectors/woocommerce/html';
import { fromMinor } from '@/server/connectors/woocommerce/money';
import { SHOPIFY_API_VERSION, type ShopifyProduct } from '@/server/connectors/shopify/connector';

export const SHOPIFY_SHOP = 'oud-house.myshopify.com';
export const SHOPIFY_CURRENCY = 'SAR';

/**
 * What a Shopify store can hold of a catalogue: numeric ids (in catalogue order), one currency,
 * one title — Arabic when there is an Arabic one, which is then the Arabic name too — and always a
 * price (a product without one is held at 0).
 */
export function shopifyHolds(catalogue: ExternalProduct[]): ExternalProduct[] {
  return catalogue.map((p, i) => {
    const name = p.nameAr ?? p.name;
    return {
      ...p, externalId: String(1000 + i), name, nameAr: /[؀-ۿ]/.test(name) ? name : null,
      currency: SHOPIFY_CURRENCY, priceMinor: p.priceMinor ?? 0,
    };
  });
}

const cursorOf = (id: number) => Buffer.from(JSON.stringify({ last_id: id, last_value: String(id) })).toString('base64');
const idOfCursor = (cursor: string) => (JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { last_id: number }).last_id;
const shopifyStatus = (s: ExternalProduct['status']) => s.toUpperCase();

export class ShopifyStore {
  readonly products = new Map<number, ShopifyProduct>();
  readonly tokens = new Set<string>(['shpat_ok']);
  down = false;
  /** What `productsCount` says of its count: Shopify answers AT_LEAST past its limit. */
  countPrecision: 'EXACT' | 'AT_LEAST' = 'EXACT';
  /** Answer this many requests with THROTTLED before serving again. */
  throttleNext = 0;
  requests = 0;
  readonly operations: string[] = [];

  constructor(catalogue: ExternalProduct[] = []) {
    for (const p of shopifyHolds(catalogue)) this.products.set(Number(p.externalId), ShopifyStore.toShopify(p));
  }

  static toShopify(p: ExternalProduct): ShopifyProduct {
    return {
      id: `gid://shopify/Product/${p.externalId}`, legacyResourceId: p.externalId, title: p.name, status: shopifyStatus(p.status),
      descriptionHtml: textToHtml(p.description), updatedAt: p.updatedAt.toISOString().replace('.000Z', 'Z'),
      priceRangeV2: { minVariantPrice: { amount: fromMinor(p.priceMinor ?? 0, SHOPIFY_CURRENCY), currencyCode: SHOPIFY_CURRENCY } },
      variants: { nodes: [{ sku: p.sku ?? '' }] },
      // A video among the media answers {} through the MediaImage fragment, as Shopify does.
      media: { nodes: [...p.images.map((i) => ({ image: { url: i.url, altText: i.alt ?? null } })), {}] },
    };
  }

  /** A merchant edits a product in the Shopify admin. */
  change(externalId: string, patch: Partial<ExternalProduct>, at: Date): void {
    const current = this.products.get(Number(externalId));
    if (!current) throw new Error(`no product ${externalId}`);
    this.products.set(Number(externalId), {
      ...current, ...(patch.name ? { title: patch.name } : {}), updatedAt: at.toISOString().replace('.000Z', 'Z'),
    });
  }

  private matching(query: string | null): ShopifyProduct[] {
    let after: number | null = null;
    if (query) {
      const m = /^updated_at:>='([^']+)'$/.exec(query);
      if (!m) throw new Error(`the stand-in does not understand the search "${query}"`);
      after = new Date(m[1]!).getTime();
    }
    return [...this.products.values()]
      .filter((p) => after === null || new Date(p.updatedAt).getTime() >= after)
      .sort((a, b) => Number(a.legacyResourceId) - Number(b.legacyResourceId));
  }

  /** The `fetch` the connector's transport is given. */
  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    this.requests += 1;
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    if (this.down) return new Response('Service Unavailable', { status: 503 });
    if (url.host !== SHOPIFY_SHOP || url.pathname !== `/admin/api/${SHOPIFY_API_VERSION}/graphql.json` || (init?.method ?? 'GET') !== 'POST') {
      return new Response('Not Found', { status: 404 });
    }
    const token = new Headers(init?.headers).get('x-shopify-access-token') ?? '';
    if (!this.tokens.has(token)) {
      return Response.json({ errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' }, { status: 401 });
    }
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
    const operation = /^query (\w+)/.exec(query)?.[1] ?? '';
    this.operations.push(operation);
    const cost = { requestedQueryCost: 112, actualQueryCost: 60, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 1988, restoreRate: 100 } };
    if (this.throttleNext > 0) {
      this.throttleNext -= 1;
      return Response.json({
        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED', documentation: 'https://shopify.dev/api/usage/rate-limits' } }],
        extensions: { cost: { ...cost, throttleStatus: { ...cost.throttleStatus, currentlyAvailable: 12 } } },
      });
    }

    if (operation === 'Check') return Response.json({ data: { shop: { name: 'Oud House' } }, extensions: { cost } });
    if (operation === 'ProductOne') {
      const id = /^gid:\/\/shopify\/Product\/(\d+)$/.exec(String(variables.id))?.[1];
      return Response.json({ data: { product: (id && this.products.get(Number(id))) || null }, extensions: { cost } });
    }
    if (operation === 'ProductsFirst' || operation === 'ProductsNext') {
      const first = Math.min(250, Number(variables.first));
      const all = this.matching((variables.query as string | null) ?? null);
      const afterId = operation === 'ProductsNext' ? idOfCursor(String(variables.after)) : null;
      const rest = afterId === null ? all : all.filter((p) => Number(p.legacyResourceId) > afterId);
      const nodes = rest.slice(0, first);
      const data: Record<string, unknown> = {
        products: { nodes, pageInfo: { hasNextPage: rest.length > first, endCursor: nodes.length ? cursorOf(Number(nodes.at(-1)!.legacyResourceId)) : null } },
      };
      if (operation === 'ProductsFirst') data.productsCount = { count: all.length, precision: this.countPrecision };
      return Response.json({ data, extensions: { cost } });
    }
    return Response.json({ errors: [{ message: `Field '${operation}' doesn't exist`, extensions: { code: 'undefinedField' } }] });
  }) as typeof fetch;
}
