import type { Metadata, Viewport } from 'next';
import { cache } from 'react';
import Capture from './capture';
import { readSession } from '@site/lib/pair-store';
import { pairingOfSession, type Pairing } from '@site/lib/pair-product';

type Params = { params: Promise<{ token: string }> };

// T134.3: the phone page is the camera, edge to edge on black (under the notch too) — not the site's navy.
export const viewport: Viewport = { themeColor: '#000000', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

/** T61/T134.3 — what the pairing recorded: the store (never Tajribah) and the product to try on, or null when expired. */
const pairingOf = cache(async (token: string): Promise<Pairing | null> => {
  try { const session = await readSession(token); return session ? pairingOfSession(session) : null; } catch { return null; }
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const pairing = await pairingOf((await params).token);
  // The store's own title stands alone: the site's "| تجربة Tajribah" suffix would put our name back (T134.3: on every plan).
  const name = pairing?.product?.name.ar;
  const store = pairing?.brand?.name.ar;
  const title = [name, store].filter(Boolean).join(' · ') || 'جرّبها عليك';
  const logo = pairing?.brand?.logo;
  return { title: { absolute: title }, robots: { index: false, follow: false }, ...(logo ? { icons: { icon: logo, apple: logo } } : {}) };
}

export default async function Page({ params }: Params) {
  const { token } = await params;
  return <Capture token={token} pairing={await pairingOf(token)} />;
}
