/**
 * The static preview shell.
 *
 * Same page components as the Next app, a hash router instead of real routes, and the
 * seeded demo source instead of the API. Nothing here is a mock-up of a screen — it is the
 * screen, with a different environment underneath (see lib/app-env.tsx).
 */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppEnvContext, type AppEnv } from '@/lib/app-env';
import { DataProvider, demoSource } from '@/lib/data';
import { DemoAuthProvider } from '@/lib/auth';
import { screenFor } from '@/components/routes';
import { LangProvider } from '@/lib/i18n';
import { DEFAULT_LANG, LANG_COOKIE, dirOf, type Lang } from '@/lib/lang';

/** `#/login?next=%2Fdashboard` → path `/login`, search `?next=%2Fdashboard`. */
const locationFromHash = (): { path: string; search: string } => {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith('/')) return { path: '/dashboard', search: '' };
  const at = hash.indexOf('?');
  return at === -1 ? { path: hash, search: '' } : { path: hash.slice(0, at), search: hash.slice(at) };
};

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_COOKIE);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch { /* private mode */ }
  return DEFAULT_LANG;
}

function App() {
  const [{ path, search }, setLocation] = useState(locationFromHash);

  useEffect(() => {
    const onHashChange = () => {
      setLocation(locationFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const env: AppEnv = {
    toHref: (p) => `#${p}`,
    asset: (p) => `.${p}`,
    path,
    search,
    navigate: (next) => { window.location.hash = next; },
    demo: true,
  };


  return (
    <AppEnvContext.Provider value={env}>
      <LangProvider initial={readLang()}>
        <DemoAuthProvider>
          <DataProvider source={demoSource}>
            {screenFor(path)}
          </DataProvider>
        </DemoAuthProvider>
      </LangProvider>
    </AppEnvContext.Provider>
  );
}

const initial = readLang();
document.documentElement.lang = initial;
document.documentElement.dir = dirOf(initial);
if (!window.location.hash) window.location.hash = '/dashboard';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
