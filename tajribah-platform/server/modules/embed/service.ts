/**
 * P1.17 — the snippet for this store, and checking a live product page for it.
 *
 * The page is fetched by our server under `safeTarget`'s rules: redirects are followed by
 * hand (at most 3) and every hop is checked again — a store page that redirects to an
 * internal address is refused, not followed. 8 seconds, 1 MB, no cookies.
 */
import { storeConnections } from '@/db/schema';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { embedSnippet } from '@/widget/src/snippet';
import { inspectHtml, safeTarget, type InstallStatus } from './check';

export const CHECK_TIMEOUT_MS = 8000;
export const CHECK_MAX_BYTES = 1024 * 1024;

/** The store key merchants paste: the store's slug — already public in its URLs. */
export async function snippetFor(ctx: TenantContext): Promise<{ storeKey: string; snippet: string; storeHost: string | null }> {
  ctx.require('ar:read');
  return { storeKey: ctx.tenant.slug, snippet: embedSnippet(ctx.tenant.slug), storeHost: await storeHost(ctx) };
}

export async function checkInstall(ctx: TenantContext, url: string, fetchImpl: typeof fetch = fetch): Promise<InstallStatus & { url: string }> {
  ctx.require('ar:read');
  const host = await storeHost(ctx);
  let target = safeTarget(url, host);
  if (!target.ok) throw errors.validation({ url: [target.reason] });

  for (let hop = 0; hop <= 3; hop++) {
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
    return { ...inspectHtml(html, ctx.tenant.slug), url: target.url.href };
  }
  return { status: 'unreachable', detail: 'too many redirects', url };
}

async function storeHost(ctx: TenantContext): Promise<string | null> {
  const connections = await ctx.db.find(storeConnections, undefined, { limit: 10 });
  const withUrl = connections.find((c) => c.status === 'active' && c.storeUrl) ?? connections.find((c) => c.storeUrl);
  try { return withUrl?.storeUrl ? new URL(withUrl.storeUrl).hostname : null; } catch { return null; }
}

/** The first `CHECK_MAX_BYTES` of the body as text; the rest is never read. */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < CHECK_MAX_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(size, CHECK_MAX_BYTES));
  let at = 0;
  for (const c of chunks) { const take = Math.min(c.byteLength, out.byteLength - at); out.set(c.subarray(0, take), at); at += take; if (at >= out.byteLength) break; }
  return new TextDecoder().decode(out);
}
