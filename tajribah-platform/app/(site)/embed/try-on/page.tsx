import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { cache } from 'react';
import { preload } from 'react-dom';
import EmbedTryOn, { type EmbedState } from '@site/components/pages/EmbedTryOn';
import { brandFrom, configBase, embedTitle, configUrl, isLocalHost, studioImages, tryOnProductFrom, validRefs } from '@site/lib/tryon-config';
import { servesHere, STORE_HOST_HEADER } from '@site/lib/store-host';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/**
 * P5.12 — the config is read here, at the edge, not after the page's scripts have run in the
 * shopper's phone: the studio arrives in the HTML with the merchant's watch, and every picture it
 * waits for is named up front so the phone fetches them alongside the scripts. When the config
 * host cannot be reached, the page falls back to reading it in the browser, as before.
 */
const load = cache(async (store: string, product: string, base: string, local: boolean, storeHost: string | null): Promise<EmbedState | undefined> => {
  if (!validRefs(store, product)) return { kind: 'unavailable' };
  try {
    const response = await fetch(configUrl(configBase(base, local), store, product), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(2500) });
    if (response.status === 404) return { kind: 'unavailable' };
    if (!response.ok) return undefined;
    const json: unknown = await response.json();
    // P1.19: on a store's own address, only that store's watches (the config names its address).
    if (!servesHere(storeHost, (json as { host?: string | null } | null)?.host)) return { kind: 'unavailable' };
    const found = tryOnProductFrom(json, local);
    return found ? { kind: 'ready', product: found, brand: brandFrom(json, local) } : { kind: 'unavailable' };
  } catch {
    return undefined;
  }
});

async function initialOf(query: Record<string, string | string[] | undefined>) {
  const h = await headers();
  const host = (h.get('host') ?? '').replace(/:\d+$/, '');
  // T75: on this computer, this app's own configs (`/v1`) unless `base` names another local server.
  const base = one(query.base) || (isLocalHost(host) ? `http://${h.get('host')}/v1` : '');
  return load(one(query.store), one(query.product), base, isLocalHost(host), h.get(STORE_HOST_HEADER));
}

// P5 (T26) — opened in a frame over a merchant's product page; not a site page. T61: an Enterprise
// store's own name in the title (the frame speaks the shop page's language, Arabic by default).
export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const query = await searchParams;
  const initial = await initialOf(query);
  const brand = initial?.kind === 'ready' ? initial.brand : null;
  // A store's own title stands alone: the site's "| تجربة Tajribah" suffix would put our name back.
  const title = brand ? { absolute: embedTitle(brand, one(query.lang) === 'en' ? 'en' : 'ar') } : embedTitle(null, 'ar');
  return { title, robots: { index: false, follow: false } };
}

export default async function Page({ searchParams }: { searchParams: Search }) {
  const initial = await initialOf(await searchParams);
  if (initial?.kind === 'ready') for (const src of studioImages(initial.product)) preload(src, { as: 'image' });
  return <EmbedTryOn initial={initial} storeHost={(await headers()).get(STORE_HOST_HEADER)} />;
}
