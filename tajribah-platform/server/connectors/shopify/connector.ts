/**
 * P6 — the Shopify connector: a store's catalogue over the GraphQL Admin API (new apps cannot use
 * the REST product endpoints), with the offline access token the store grants on install.
 *
 *  - **Credentials** are the shop's `*.myshopify.com` domain and its token, kept together as the
 *    connection's sealed access token (`shopifyToken`). Offline tokens do not expire: `refresh`
 *    checks the token is still accepted — a 401, a 403 or `ACCESS_DENIED` means the app was
 *    uninstalled or its access cut, and only reconnecting helps.
 *  - **Paging** by product id (`sortKey: ID`) with Shopify's cursor, 100 a page: an edit never
 *    moves a product between pages, so a sync that resumes from a stored cursor misses nothing.
 *  - **Changed since**: `updated_at:>=` — at or after, as the engine expects.
 *  - **Total**: `productsCount` on the first page, only when Shopify says it is exact.
 *  - **What Shopify cannot say**: one currency per shop; one title (Arabic when written in Arabic —
 *    then it is the Arabic name too; translations live elsewhere); a product always has a price
 *    (its lowest variant's — Shopify has no "no price"); the SKU is the first variant's.
 *  - **Throttling** is reported inside a 200 answer (`THROTTLED`), not as a 429: the connector waits
 *    for the points it needs at the restore rate Shopify reports, twice at most, then fails loudly
 *    so the job is retried later.
 *  - A GraphQL read is sent as a POST marked safe to repeat, so the transport retries it like a GET.
 */
import { errors } from '../../core/errors/problem';
import { Transport } from '../transport';
import { TokenRevokedError, type Connector, type ExternalProduct, type Page, type TokenSet } from '../types';
import { htmlToText } from '../woocommerce/html';
import { toMinor } from '../woocommerce/money';

/** Shopify releases an Admin API version each quarter and supports each for a year: move it on yearly. */
export const SHOPIFY_API_VERSION = '2026-07';
export const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export type ShopifyCredentials = { shop: string; token: string };

/** The access token a Shopify connection stores (sealed): its shop domain and offline token. */
export const shopifyToken = (credentials: ShopifyCredentials): string => JSON.stringify(credentials);

export function shopifyCredentials(accessToken: string): ShopifyCredentials {
  let parsed: unknown;
  try { parsed = JSON.parse(accessToken); } catch { throw new TokenRevokedError('not a Shopify access token'); }
  const c = parsed as Partial<ShopifyCredentials>;
  if (typeof c.shop !== 'string' || !SHOP_DOMAIN.test(c.shop) || typeof c.token !== 'string' || !c.token) throw new TokenRevokedError('not a Shopify access token');
  return { shop: c.shop, token: c.token };
}

/** A product as the GraphQL Admin API returns it — the fields asked for here. */
export type ShopifyProduct = {
  id: string; legacyResourceId: string; title: string; status: string; descriptionHtml: string; updatedAt: string;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
  variants: { nodes: { sku: string | null }[] };
  media: { nodes: { image?: { url: string; altText: string | null } | null }[] };
};

const PER_PAGE = 100;
const FIELDS = `id legacyResourceId title status descriptionHtml updatedAt
  priceRangeV2 { minVariantPrice { amount currencyCode } }
  variants(first: 1) { nodes { sku } }
  media(first: 20) { nodes { ... on MediaImage { image { url altText } } } }`;
export const QUERIES = {
  first: `query ProductsFirst($first: Int!, $query: String) {
  products(first: $first, query: $query, sortKey: ID) { nodes { ${FIELDS} } pageInfo { hasNextPage endCursor } }
  productsCount(query: $query, limit: null) { count precision }
}`,
  next: `query ProductsNext($first: Int!, $after: String!, $query: String) {
  products(first: $first, after: $after, query: $query, sortKey: ID) { nodes { ${FIELDS} } pageInfo { hasNextPage endCursor } }
}`,
  one: `query ProductOne($id: ID!) { product(id: $id) { ${FIELDS} } }`,
  check: 'query Check { shop { name } }',
};

const hasArabic = (text: string) => /[؀-ۿ]/.test(text);

export function statusOf(shopify: string): ExternalProduct['status'] {
  if (shopify === 'ACTIVE') return 'active';
  if (shopify === 'ARCHIVED') return 'archived';
  return 'draft'; // DRAFT, and anything Shopify adds later until it is looked at
}

export function toExternal(p: ShopifyProduct): ExternalProduct {
  const name = p.title.trim();
  const { amount, currencyCode } = p.priceRangeV2.minVariantPrice;
  const sku = p.variants.nodes[0]?.sku;
  return {
    externalId: p.legacyResourceId,
    sku: sku ? sku : null,
    name,
    nameAr: hasArabic(name) ? name : null,
    description: htmlToText(p.descriptionHtml),
    priceMinor: toMinor(amount, currencyCode),
    currency: currencyCode,
    images: p.media.nodes.flatMap((m) => (m.image && /^https:\/\//.test(m.image.url) ? [{ url: m.image.url, ...(m.image.altText ? { alt: m.image.altText } : {}) }] : [])),
    status: statusOf(p.status),
    updatedAt: new Date(p.updatedAt),
  };
}

type GraphQlAnswer<T> = {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[] | string;
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable: number; restoreRate: number } } };
};

const MAX_THROTTLE_WAITS = 2;

export class ShopifyConnector implements Connector {
  readonly provider = 'shopify' as const;

  constructor(
    private readonly transport: Transport = new Transport('shopify'),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async graphql<T>(c: ShopifyCredentials, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let waits = 0; ; waits++) {
      const response = await this.transport.send(c.shop, `https://${c.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: { 'x-shopify-access-token': c.token, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
      }, { idempotent: true });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new TokenRevokedError(`Shopify refused the token (${response.status})`);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw errors.upstream('shopify', new Error(`graphql: ${response.status}`));
      }
      const body = await response.json() as GraphQlAnswer<T>;
      const list = Array.isArray(body.errors) ? body.errors : body.errors ? [{ message: body.errors }] : [];
      if (list.some((e) => e.extensions?.code === 'ACCESS_DENIED')) throw new TokenRevokedError('Shopify denied access to products');
      if (list.some((e) => e.extensions?.code === 'THROTTLED')) {
        if (waits >= MAX_THROTTLE_WAITS) throw errors.upstream('shopify', new Error('throttled'));
        const cost = body.extensions?.cost;
        const needed = Math.max(1, (cost?.requestedQueryCost ?? 100) - (cost?.throttleStatus?.currentlyAvailable ?? 0));
        await this.sleep(Math.ceil((needed / Math.max(1, cost?.throttleStatus?.restoreRate ?? 50)) * 1000));
        continue;
      }
      if (list.length) throw errors.upstream('shopify', new Error(`graphql: ${list.map((e) => e.message).join('; ').slice(0, 300)}`));
      if (!body.data) throw errors.upstream('shopify', new Error('graphql: no data'));
      return body.data;
    }
  }

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    const c = shopifyCredentials(tokens.accessToken);
    await this.graphql(c, QUERIES.check);
    return { accessToken: tokens.accessToken, refreshToken: null, expiresAt: null, scopes: tokens.scopes ?? ['read_products'] };
  }

  async listProducts(accessToken: string, cursor: string | null, since?: Date | null): Promise<Page<ExternalProduct>> {
    const c = shopifyCredentials(accessToken);
    const query = since ? `updated_at:>='${since.toISOString()}'` : null;
    type Products = { products: { nodes: ShopifyProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }; productsCount?: { count: number; precision: string } };
    const data = cursor
      ? await this.graphql<Products>(c, QUERIES.next, { first: PER_PAGE, after: cursor, query })
      : await this.graphql<Products>(c, QUERIES.first, { first: PER_PAGE, query });
    if (!Array.isArray(data.products?.nodes)) throw errors.upstream('shopify', new Error('products: not a list'));
    const { hasNextPage, endCursor } = data.products.pageInfo;
    const total = data.productsCount?.precision === 'EXACT' ? data.productsCount.count : null;
    return { items: data.products.nodes.map(toExternal), next: hasNextPage && endCursor ? endCursor : null, total };
  }

  async getProduct(accessToken: string, externalId: string): Promise<ExternalProduct | null> {
    if (!/^\d+$/.test(externalId)) return null; // Shopify product ids are numbers
    const c = shopifyCredentials(accessToken);
    const data = await this.graphql<{ product: ShopifyProduct | null }>(c, QUERIES.one, { id: `gid://shopify/Product/${externalId}` });
    return data.product ? toExternal(data.product) : null;
  }
}
