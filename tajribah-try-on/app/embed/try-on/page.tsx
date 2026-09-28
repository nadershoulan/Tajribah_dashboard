import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { preload } from 'react-dom';
import EmbedTryOn, { type EmbedState } from '@/components/pages/EmbedTryOn';
import { configBase, configUrl, isLocalHost, studioImages, tryOnProductFrom, validRefs } from '@/lib/tryon-config';

// P5 (T26) — opened in a frame over a merchant's product page; not a site page.
export const metadata: Metadata = { title: 'Tajribah try-on', robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/**
 * P5.12 — the config is read here, at the edge, not after the page's scripts have run in the
 * shopper's phone: the studio arrives in the HTML with the merchant's watch, and every picture it
 * waits for is named up front so the phone fetches them alongside the scripts. When the config
 * host cannot be reached, the page falls back to reading it in the browser, as before.
 */
async function load(store: string, product: string, base: string, local: boolean): Promise<EmbedState | undefined> {
  if (!validRefs(store, product)) return { kind: 'unavailable' };
  try {
    const response = await fetch(configUrl(configBase(base, local), store, product), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(2500) });
    if (response.status === 404) return { kind: 'unavailable' };
    if (!response.ok) return undefined;
    const found = tryOnProductFrom(await response.json(), local);
    return found ? { kind: 'ready', product: found } : { kind: 'unavailable' };
  } catch {
    return undefined;
  }
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const host = ((await headers()).get('host') ?? '').replace(/:\d+$/, '');
  const initial = await load(one(query.store), one(query.product), one(query.base), isLocalHost(host));
  if (initial?.kind === 'ready') for (const src of studioImages(initial.product)) preload(src, { as: 'image' });
  return <EmbedTryOn initial={initial} />;
}
