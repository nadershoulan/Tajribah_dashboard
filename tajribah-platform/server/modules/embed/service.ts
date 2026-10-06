/**
 * P1.17 — the snippet for this store, and checking a live product page for it.
 *
 * The page is fetched by our server under `safeTarget`'s rules: redirects are followed by
 * hand (at most 3) and every hop is checked again — a store page that redirects to an
 * internal address is refused, not followed. 8 seconds, 1 MB, no cookies.
 *
 * P7.7 (T45): before each hop the host is resolved over DNS-over-HTTPS and a name that points at
 * a private or reserved address is refused (`isPrivateAddress`). A failed lookup refuses too — the
 * checker never fetches a page it could not place.
 */
import { and, inArray, isNotNull, isNull } from 'drizzle-orm';
import { edgeConfigs, products, storeConnections } from '@/db/schema';
import { errors } from '@/server/core/errors/problem';
import { LIMITS, rateLimiter } from '@/server/core/ratelimit/limiter';
import type { TenantContext } from '@/server/core/tenancy/context';
import { pageRefOf } from '@/widget/src/auto';
import { embedSnippet, tagManagerSnippet } from '@/widget/src/snippet';
import type { EmbedInfo, InstallCheck } from '@/lib/view-models';
import { publicationOf } from '@/server/modules/edge/publish';
import { inspectContainer, inspectHtml, isPrivateAddress, safeTarget, tagManagerIds, type ContainerVerdict } from './check';

export const CHECK_TIMEOUT_MS = 8000;
export const CHECK_MAX_BYTES = 1024 * 1024;
export const DOH_URL = 'https://cloudflare-dns.com/dns-query';

export type Resolver = (host: string) => Promise<string[] | null>;

/** A and AAAA answers for `host` from a DNS-over-HTTPS JSON endpoint; null when the lookup fails. */
export function dohResolver(fetchImpl: typeof fetch): Resolver {
  return async (host) => {
    try {
      const answers: string[] = [];
      for (const type of ['A', 'AAAA']) {
        const response = await fetchImpl(`${DOH_URL}?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(3000) });
        if (!response.ok) return null;
        const body = await response.json() as { Status?: number; Answer?: { type: number; data: string }[] };
        if (body.Status !== 0 && body.Status !== 3) return null; // 3 = no such name: no answers, not a failure
        for (const a of body.Answer ?? []) if (a.type === 1 || a.type === 28) answers.push(a.data);
      }
      return answers;
    } catch {
      return null;
    }
  };
}

/**
 * The store key merchants paste: the store's slug — already public in its URLs. T95: with the Tag Manager
 * tag, and how many live products a page-wide tag can find (those whose store page is known).
 */
export async function snippetFor(ctx: TenantContext): Promise<EmbedInfo> {
  ctx.require('ar:read');
  const live = await ctx.db.find(edgeConfigs, and(isNotNull(edgeConfigs.key), isNull(edgeConfigs.withdrawnAt)), { limit: 5000 });
  // a product made in Tajribah has no page in the store: only imported ones can be found by a page-wide tag
  const imported = live.length ? await ctx.db.find(products, and(inArray(products.id, live.map((r) => r.productId)), isNotNull(products.connectionId)), { limit: live.length }) : [];
  return {
    storeKey: ctx.tenant.slug, snippet: embedSnippet(ctx.tenant.slug), tagSnippet: tagManagerSnippet(ctx.tenant.slug), storeHost: await storeHost(ctx),
    published: live.length, publishedFromStore: imported.length, publishedWithPage: live.filter((r) => r.pageKey).length,
  };
}

export async function checkInstall(ctx: TenantContext, url: string, fetchImpl: typeof fetch = fetch, resolve: Resolver = dohResolver(fetchImpl)): Promise<InstallCheck> {
  ctx.require('ar:read');
  const host = await storeHost(ctx);
  let target = safeTarget(url, host);
  if (!target.ok) throw errors.validation({ url: [target.reason] });
  const limit = await rateLimiter().hit(`install-check:${ctx.tenantId}`, LIMITS.installCheck.limit, LIMITS.installCheck.windowSeconds); // P7
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);

  for (let hop = 0; hop <= 3; hop++) {
    const addresses = await resolve(target.url.hostname);
    if (addresses === null) return { status: 'unreachable', detail: 'we could not look up the address', url: target.url.href };
    if (addresses.length === 0) return { status: 'unreachable', detail: 'the address does not exist', url: target.url.href };
    if (addresses.some(isPrivateAddress)) return { status: 'unreachable', detail: 'the address points to a private network, which we will not open', url: target.url.href };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(target.url.href, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'TajribahInstallCheck/1.0', accept: 'text/html' } });
    } catch {
      clearTimeout(timer);
      return { status: 'unreachable', detail: 'the page did not answer', url: target.url.href };
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      clearTimeout(timer);
      target = safeTarget(new URL(response.headers.get('location')!, target.url).href, host);
      if (!target.ok) return { status: 'unreachable', detail: `redirected somewhere we will not follow: ${target.reason}`, url };
      continue;
    }
    if (!response.ok) { clearTimeout(timer); return { status: 'unreachable', detail: `the page answered ${response.status}`, url: target.url.href }; }
    const html = await readCapped(response).finally(() => clearTimeout(timer));
    const found = inspectHtml(html, ctx.tenant.slug);
    // T37: installed right is half the answer — is this product's button live?
    if (found.status === 'installed') return { ...found, url: target.url.href, product: await publicationOf(ctx, found.productRef), via: 'page' };
    // T95: not in the page's own HTML — maybe in the Tag Manager container the page loads
    if (found.status === 'missing_script') {
      const viaTags = await throughTagManager(ctx, html, target.url.href, fetchImpl);
      if (viaTags) return viaTags;
    }
    return { ...found, url: target.url.href };
  }
  return { status: 'unreachable', detail: 'too many redirects', url };
}

/** T95: Google serves each published container here; only the id varies, and it is checked first. */
export const TAG_MANAGER_URL = 'https://www.googletagmanager.com/gtm.js?id=';
/** A busy container is a few hundred kilobytes. */
export const CONTAINER_MAX_BYTES = 4 * 1024 * 1024;

/**
 * T95 — a page without our script in its HTML may still run it: Google Tag Manager adds it after the
 * page loads. The containers the page names are read from Google (a fixed host, so nothing the
 * merchant typed is fetched) and searched for our tag. Null when the page loads no container.
 */
async function throughTagManager(ctx: TenantContext, html: string, url: string, fetchImpl: typeof fetch): Promise<InstallCheck | null> {
  const ids = tagManagerIds(html);
  if (!ids.length) return null;
  const verdicts: ContainerVerdict[] = [];
  for (const id of ids) {
    try {
      const response = await fetchImpl(TAG_MANAGER_URL + encodeURIComponent(id), { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), headers: { 'user-agent': 'TajribahInstallCheck/1.0' } });
      if (response.ok) verdicts.push(inspectContainer(await readCapped(response, CONTAINER_MAX_BYTES), ctx.tenant.slug));
    } catch { /* that container could not be read; the others may answer */ }
  }
  if (verdicts.some((v) => v.status === 'ok')) {
    const ref = pageRefOf(url);
    if (!ref) return { status: 'not_product_page', detail: null, url };
    return { status: 'installed', productRef: ref, url, product: await publicationOf(ctx, ref), via: 'tag_manager' };
  }
  const wrong = verdicts.find((v) => v.status === 'wrong_store');
  if (wrong) return { status: 'wrong_store', detail: wrong.key, url };
  if (verdicts.some((v) => v.status === 'not_auto')) return { status: 'tag_needs_update', detail: null, url };
  if (!verdicts.length) return { status: 'unreachable', detail: 'we could not read your Google Tag Manager container', url };
  return { status: 'tag_manager_missing', detail: ids.join(', '), url };
}

async function storeHost(ctx: TenantContext): Promise<string | null> {
  const connections = await ctx.db.find(storeConnections, undefined, { limit: 10 });
  const withUrl = connections.find((c) => c.status === 'active' && c.storeUrl) ?? connections.find((c) => c.storeUrl);
  try { return withUrl?.storeUrl ? new URL(withUrl.storeUrl).hostname : null; } catch { return null; }
}

/** The first `max` bytes of the body as text; the rest is never read. */
async function readCapped(response: Response, max = CHECK_MAX_BYTES): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const c of chunks) { const take = Math.min(c.byteLength, out.byteLength - at); out.set(c.subarray(0, take), at); at += take; if (at >= out.byteLength) break; }
  return new TextDecoder().decode(out);
}
