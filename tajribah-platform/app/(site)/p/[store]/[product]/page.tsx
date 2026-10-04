import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { cache } from 'react';
import HostedPage, { type HostedState } from '@site/components/pages/HostedPage';
import { hostedProductFrom } from '@site/lib/hosted-page';
import { configBase, configUrl, isLocalHost, validRefs } from '@site/lib/tryon-config';
import { servesHere, STORE_HOST_HEADER } from '@site/lib/store-host';

type Params = Promise<{ store: string; product: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
/** A path segment as written; one that is not valid percent-encoding is taken as it is. */
const segment = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };

/**
 * P1.19 — a product's own page. The config is read here, at the edge, so a shared link opens with
 * the product already in the HTML (and its link preview has the product's name and picture). When the
 * config host cannot be reached, the page reads it in the browser instead.
 */
const load = cache(async (store: string, product: string, base: string, local: boolean, storeHost: string | null): Promise<HostedState | undefined> => {
  if (!validRefs(store, product)) return { kind: 'unavailable' };
  try {
    const response = await fetch(configUrl(configBase(base, local), store, product), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(2500) });
    if (response.status === 404) return { kind: 'unavailable' };
    if (!response.ok) return undefined;
    const found = hostedProductFrom(await response.json(), local);
    // On a store's own address, only that store's products — never another's under its name.
    return found && servesHere(storeHost, found.host) ? { kind: 'ready', product: found } : { kind: 'unavailable' };
  } catch {
    return undefined;
  }
});

async function initialOf(params: Params, search: Search) {
  const raw = await params;
  const [store, product] = [segment(raw.store), segment(raw.product)];
  const h = await headers();
  const host = (h.get('host') ?? '').replace(/:\d+$/, '');
  const storeHost = h.get(STORE_HOST_HEADER);
  // T75: on this computer, this app's own configs (`/v1`) unless `base` names another local server.
  const base = one((await search).base) || (isLocalHost(host) ? `http://${h.get('host')}/v1` : '');
  return { store, product, storeHost, initial: await load(store, product, base, isLocalHost(host), storeHost) };
}

// A merchant's page, not one of the site's: not indexed (the shop's own page should rank), titled
// with the product and the store — never "| Tajribah" on a store's product.
export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { initial } = await initialOf(params, searchParams);
  const robots = { index: false, follow: false };
  if (initial?.kind !== 'ready') return { title: { absolute: 'تجربة Tajribah' }, robots };
  const p = initial.product;
  const en = one((await searchParams).lang) === 'en';
  const title = en ? `${p.name.en} · ${p.store.en}` : `${p.name.ar} · ${p.store.ar}`;
  const description = en ? 'See it in 3D and at its real size — no app needed.' : 'شاهدها بأبعادها الثلاثية وبمقاسها الحقيقي — من دون تطبيق.';
  const images = p.image ? [{ url: p.image }] : undefined;
  return {
    title: { absolute: title }, description, robots,
    openGraph: { type: 'website', title, description, siteName: en ? p.store.en : p.store.ar, ...(images ? { images } : {}) },
    twitter: { card: images ? 'summary_large_image' : 'summary', title, description, ...(images ? { images: images.map((i) => i.url) } : {}) },
  };
}

export default async function Page({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { store, product, storeHost, initial } = await initialOf(params, searchParams);
  return <HostedPage initial={initial} store={store} product={product} storeHost={storeHost} />;
}
