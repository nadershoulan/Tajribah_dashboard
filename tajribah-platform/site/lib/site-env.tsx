'use client';

import { createContext, useContext, type AnchorHTMLAttributes } from 'react';

/**
 * The same page components run in two shells:
 *  - the Next.js app (real routes, API routes, downloads), and
 *  - the static preview (hash routes, no server).
 * Everything that differs between them lives here, so pages never branch on
 * where they are running.
 */
export type SiteEnv = {
  /** Map a site path such as `/pricing` to an href for this shell. */
  toHref: (path: string) => string;
  /** Map a public file such as `/brand/tajribah-logo.png` to a URL for this shell. */
  asset: (path: string) => string;
  features: {
    /** QR hand-off to a phone needs the /api/pair routes and R2 storage. */
    pairing: boolean;
    /** Saving the try-on image needs a context where downloads are allowed. */
    download: boolean;
  };
};

export const DEFAULT_ENV: SiteEnv = {
  toHref: (p) => p,
  asset: (p) => p,
  features: { pairing: true, download: true },
};

export const SiteEnvContext = createContext<SiteEnv>(DEFAULT_ENV);
export const useSiteEnv = () => useContext(SiteEnvContext);

const EXTERNAL = /^(https?:|mailto:|tel:|#)/;

export function SiteLink({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { toHref } = useSiteEnv();
  return <a href={EXTERNAL.test(href) ? href : toHref(href)} {...rest} />;
}
