'use client';

/**
 * The same page components render in two shells:
 *   - the Next.js app (real routes, real API, real data), and
 *   - the static preview (hash routes, no server, seeded demo data).
 *
 * Everything that differs lives here, so a page never branches on where it is running.
 * This is the pattern that worked in `../tajribah-try-on`; it is what keeps the preview
 * honest — the preview renders the *real* components, not a mock-up of them.
 */
import { createContext, useContext, type AnchorHTMLAttributes, type ReactNode } from 'react';

export type AppEnv = {
  /** Map a route such as `/dashboard/products` to an href for this shell. */
  toHref: (path: string) => string;
  /** Map a public file such as `/brand/tajribah-mark.png` to a URL for this shell. */
  asset: (path: string) => string;
  /** The current path, however this shell tracks it. */
  path: string;
  /** The query string, with its leading `?` (or empty) — e.g. `?next=%2Fdashboard`. */
  search: string;
  navigate: (path: string) => void;
  /** True in the static preview: data is seeded, and the UI says so. */
  demo: boolean;
};

export const DEFAULT_ENV: AppEnv = {
  toHref: (p) => p,
  asset: (p) => p,
  path: '/dashboard',
  search: '',
  navigate: () => {},
  demo: false,
};

export const AppEnvContext = createContext<AppEnv>(DEFAULT_ENV);

export const useEnv = (): AppEnv => useContext(AppEnvContext);

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode };

/** A link that works in both shells. Always use this, never a bare `<a href>`. */
export function AppLink({ href, children, onClick, ...rest }: LinkProps) {
  const env = useEnv();
  return (
    <a
      href={env.toHref(href)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        if (env.toHref(href).startsWith('#')) return; // the hash router handles it
        event.preventDefault();
        env.navigate(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
