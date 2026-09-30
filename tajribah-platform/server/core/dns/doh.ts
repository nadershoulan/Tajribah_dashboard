/**
 * T62 — DNS lookups over HTTPS (RFC 8484's JSON form, as Cloudflare's and Google's resolvers serve it),
 * so a Worker can check the records a merchant was asked to add. Workers have no DNS socket; this is
 * a plain `fetch`.
 *
 *  - TXT values arrive quoted, a long one split into several quoted strings: they are unquoted and
 *    joined, as a TXT record's value is.
 *  - CNAME targets arrive with the root's trailing dot: removed, lower-cased.
 *  - "No such name" (NXDOMAIN) and "no records of that type" are both an empty answer — the record is
 *    not there yet. A resolver failure (SERVFAIL, an unreachable resolver) is an upstream error:
 *    "we could not look", never "it is not there".
 */
import { errors } from '@/server/core/errors/problem';

export const DOH_RESOLVER = 'https://cloudflare-dns.com/dns-query';
const TYPES = { CNAME: 5, TXT: 16 } as const;

type Answer = { name?: string; type?: number; data?: string };

/** `"v=spf1 " "include:x"` → `v=spf1 include:x`. */
export function txtValue(data: string): string {
  const parts = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\(.)/g, '$1'));
  return parts.length ? parts.join('') : data;
}

export async function lookup(name: string, type: keyof typeof TYPES, fetcher: typeof fetch = fetch, resolver = DOH_RESOLVER): Promise<string[]> {
  const url = `${resolver}?${new URLSearchParams({ name, type }).toString()}`;
  let response: Response;
  try {
    response = await fetcher(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
  } catch (error) {
    throw errors.upstream('dns', error);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw errors.upstream('dns', new Error(`resolver answered ${response.status}`));
  }
  const body = await response.json() as { Status?: number; Answer?: Answer[] };
  if (body.Status === 3) return []; // NXDOMAIN: nothing there yet
  if (body.Status !== 0) throw errors.upstream('dns', new Error(`resolver status ${body.Status}`));
  return (body.Answer ?? [])
    .filter((a) => a.type === TYPES[type] && typeof a.data === 'string')
    .map((a) => (type === 'TXT' ? txtValue(a.data!) : a.data!.replace(/\.$/, '').toLowerCase()));
}
