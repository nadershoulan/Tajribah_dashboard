/**
 * A product feed instead of a linked store: the link a store's platform publishes for Google Merchant
 * Center (Salla's "Google Merchant" app, Zid's, Shopify's, WooCommerce plugins…), read like Merchant
 * Center reads it — fetched whole, every 24 hours (`FEED_INTERVAL_MINUTES`), each item a product
 * (`lib/product-feed.ts`). The sync engine does the rest as for any store: paging, plan limits,
 * archiving what left the feed (with its guard against a broken feed archiving everything).
 *
 * The connection's sealed "token" is what to read: `url:<the feed's link>` (the link usually carries
 * a secret, so it is sealed like any token), or `file:<id>` for a sheet uploaded by hand — whose
 * products are handed over while the upload's request runs (`stageFile`) and are never kept: a file
 * changes only when it is uploaded again.
 *
 * Fetching a link a merchant typed is how servers get turned on their own network: https only, a
 * public name that does not resolve to a private address (checked on every redirect, at most 3),
 * 30 seconds, 30 MB.
 */
import { FEED_MAX_BYTES, feedProblem, parseFeedText, type FeedProduct, type FeedResult } from '@/lib/product-feed';
import { isPrivateAddress, safeTarget } from '@/server/modules/embed/check';
import { dohResolver, type Resolver } from '@/server/modules/embed/service';
import type { Connector, ExternalProduct, Page, TokenSet } from '../types';

export const FEED_INTERVAL_MINUTES = 24 * 60;
export const FEED_PAGE_SIZE = 250;
export const FEED_TIMEOUT_MS = 30_000;
/** A read feed is reused while one sync pages through it, not refetched for every page. */
const CACHE_MS = 10 * 60_000;

/** Why a feed could not be read, said to the merchant as it is. */
export class FeedError extends Error {}

const cache = new Map<string, { at: number; result: FeedResult }>();
const staged = new Map<string, FeedResult>();

/** A hand-uploaded sheet's products, for the sync that runs inside its upload request. */
export function stageFile(id: string, result: FeedResult): () => void {
  staged.set(id, result);
  return () => { staged.delete(id); };
}

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > FEED_MAX_BYTES) throw new FeedError('the feed is larger than 30 MB');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > FEED_MAX_BYTES) { await reader.cancel().catch(() => undefined); throw new FeedError('the feed is larger than 30 MB'); }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

/** Fetch and read a feed's link under the rules above. */
export async function fetchFeed(link: string, fetchImpl: typeof fetch = fetch, resolve: Resolver = dohResolver(fetchImpl)): Promise<FeedResult> {
  let target = safeTarget(link, null);
  if (!target.ok) throw new FeedError(`the feed's link ${target.reason}`);
  for (let hop = 0; hop <= 3; hop++) {
    const addresses = await resolve(target.url.hostname);
    if (!addresses) throw new FeedError('we could not look up the feed’s address');
    if (!addresses.length) throw new FeedError('the feed’s address does not exist');
    if (addresses.some(isPrivateAddress)) throw new FeedError('the feed’s address points to a private network, which we will not open');
    let response: Response;
    try {
      response = await fetchImpl(target.url.href, { redirect: 'manual', signal: AbortSignal.timeout(FEED_TIMEOUT_MS), headers: { 'user-agent': 'TajribahFeedReader/1.0', accept: 'application/xml, text/xml, text/csv, text/tab-separated-values, text/plain, */*' } });
    } catch {
      throw new FeedError('the feed did not answer');
    }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      target = safeTarget(new URL(location, target.url).href, null);
      if (!target.ok) throw new FeedError(`the feed redirected somewhere we will not follow: ${target.reason}`);
      continue;
    }
    if (!response.ok) throw new FeedError(`the feed answered ${response.status}`);
    const result = parseFeedText(await readCapped(response));
    const problem = feedProblem(result);
    if (problem) throw new FeedError(problem);
    return result;
  }
  throw new FeedError('the feed redirected too many times');
}

function toExternal(p: FeedProduct, now: Date): ExternalProduct {
  return {
    externalId: p.externalId, sku: p.sku, name: p.name, nameAr: p.nameAr, description: p.description,
    priceMinor: p.priceMinor, currency: p.currency, images: p.images, status: 'active',
    updatedAt: now, // a feed says nothing of when an item changed: every read is the whole catalogue
  };
}

export class FeedConnector implements Connector {
  readonly provider = 'feed' as const;

  constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly resolve?: Resolver, private readonly now: () => Date = () => new Date()) {}

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    return tokens; // nothing expires: a feed's link is the access
  }

  private async load(token: string): Promise<FeedResult> {
    if (token.startsWith('file:')) {
      const result = staged.get(token.slice(5));
      if (!result) throw new FeedError('a file is read when it is uploaded — upload it again to update the products');
      return result;
    }
    if (!token.startsWith('url:')) throw new FeedError('this feed connection has no link');
    const hit = cache.get(token);
    if (hit && this.now().getTime() - hit.at < CACHE_MS) return hit.result;
    const result = await fetchFeed(token.slice(4), this.fetchImpl, this.resolve ?? dohResolver(this.fetchImpl));
    cache.set(token, { at: this.now().getTime(), result });
    return result;
  }

  /** Every read is the whole feed (`since` is ignored), paged by position. */
  async listProducts(token: string, cursor: string | null): Promise<Page<ExternalProduct>> {
    if (cursor === null) cache.delete(token); // a new sync reads the feed afresh
    const { products } = await this.load(token);
    const start = cursor ? Number(cursor) : 0;
    const end = start + FEED_PAGE_SIZE;
    const now = this.now();
    return { items: products.slice(start, end).map((p) => toExternal(p, now)), next: end < products.length ? String(end) : null, total: products.length };
  }

  async getProduct(token: string, externalId: string): Promise<ExternalProduct | null> {
    const found = (await this.load(token)).products.find((p) => p.externalId === externalId);
    return found ? toExternal(found, this.now()) : null;
  }
}
