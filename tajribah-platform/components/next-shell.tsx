'use client';

/**
 * P0.20 — the Next.js shell: real routes, the real API, real sign-in.
 *
 * The counterpart of `preview/main.tsx`. Both render the same screens from
 * `components/routes.tsx`; only the environment underneath differs (lib/app-env.tsx):
 * here navigation is the Next router, data is `apiSource`, and auth is `AuthProvider`.
 * Every dashboard screen is guarded by `RequireSession` inside `Shell`.
 *
 * Split in two because Next keeps the layout mounted across navigations and remounts the
 * page: `NextProviders` (in app/layout.tsx) holds the session, so moving between screens
 * does not restore it again; `NextScreen` (in the catch-all page) picks the screen.
 */
import { Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppEnvContext, type AppEnv } from '@/lib/app-env';
import { ApiClient } from '@/lib/api-client';
import { AuthProvider } from '@/lib/auth';
import { DataProvider, apiSource } from '@/lib/data';
import { LangProvider } from '@/lib/i18n';
import type { Lang } from '@/lib/lang';
import { screenFor } from '@/components/routes';

/** One client per page load: it holds the access token in memory. */
const client = new ApiClient();
const source = apiSource(client);

export function NextProviders({ initialLang, children }: { initialLang: Lang; children: ReactNode }) {
  return (
    <LangProvider initial={initialLang}>
      <AuthProvider client={client}>
        <DataProvider source={source}>{children}</DataProvider>
      </AuthProvider>
    </LangProvider>
  );
}

function Routed() {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const params = useSearchParams();
  const search = params.toString() ? `?${params.toString()}` : '';

  const env = useMemo<AppEnv>(() => ({
    toHref: (path) => path,
    asset: (path) => path,
    path: pathname,
    search,
    navigate: (next) => router.push(next),
    demo: false,
  }), [pathname, search, router]);

  useEffect(() => {
    if (pathname === '/') router.replace('/dashboard');
  }, [pathname, router]);

  return (
    <AppEnvContext.Provider value={env}>
      {screenFor(pathname)}
    </AppEnvContext.Provider>
  );
}

export function NextScreen() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return <Suspense fallback={null}><Routed /></Suspense>;
}
