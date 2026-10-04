import type { Metadata } from 'next';
import { cache } from 'react';
import Capture from './capture';
import { readSession } from '@site/lib/pair-store';

type Params = { params: Promise<{ token: string }> };

/** T61 — the brand the pairing recorded: an Enterprise store's own, or null for Tajribah's. */
const brandOf = cache(async (token: string) => {
  try { return (await readSession(token))?.brand ?? null; } catch { return null; }
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const brand = await brandOf((await params).token);
  // A store's own title stands alone: the site's "| تجربة Tajribah" suffix would put our name back.
  return { title: brand ? { absolute: `تجربتك الخاصة · ${brand.name.ar}` } : 'تجربتك الخاصة', robots: { index: false, follow: false } };
}

export default async function Page({ params }: Params) {
  const { token } = await params;
  return <Capture token={token} brand={await brandOf(token)} />;
}
