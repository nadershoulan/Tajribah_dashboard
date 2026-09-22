/**
 * Static preview shell.
 *
 * Renders the same page components as the Next.js app, but with hash routes
 * (#/pricing) and relative asset paths, so the whole site can be hosted as
 * static files with no server. Features that need the server — QR hand-off to
 * a phone (/api/pair + R2) — are switched off here; everything else is identical.
 *
 * Build: node preview/build.mjs --modules <path to a node_modules with the deps>
 */
import { StrictMode, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { LangProvider, readStoredLang, useLang } from '@/lib/i18n';
import { SiteEnvContext, type SiteEnv } from '@/lib/site-env';
import { pick } from '@/lib/lang';
import { TITLES } from '@/lib/site';
import Home from '@/components/pages/Home';
import Demo from '@/components/pages/Demo';
import Features from '@/components/pages/Features';
import HowItWorks from '@/components/pages/HowItWorks';
import Integrations from '@/components/pages/Integrations';
import Pricing from '@/components/pages/Pricing';
import About from '@/components/pages/About';
import Contact from '@/components/pages/Contact';
import FaqPage from '@/components/pages/Faq';
import NotFound from '@/components/pages/NotFound';
import { CookiesPage, PrivacyPage, RefundPage, TermsPage, TryOnPrivacyPage } from '@/components/pages/Legal';

const ROUTES: Record<string, ComponentType> = {
  '/': Home,
  '/demo': Demo,
  '/features': Features,
  '/how-it-works': HowItWorks,
  '/integrations': Integrations,
  '/pricing': Pricing,
  '/about': About,
  '/contact': Contact,
  '/faq': FaqPage,
  '/privacy': PrivacyPage,
  '/try-on-privacy': TryOnPrivacyPage,
  '/terms': TermsPage,
  '/refund': RefundPage,
  '/cookies': CookiesPage,
};

// Static hosts often refuse unknown extensions such as .task. The model is
// fetched as raw bytes, so it ships under a served binary extension instead.
const RENAMED: Record<string, string> = { '/assets/hand-landmarker.task': '/assets/hand-landmarker.task.wasm' };

const ENV: SiteEnv = {
  toHref: (p) => '#' + p,
  asset: (p) => '.' + (RENAMED[p] ?? p),
  features: { pairing: false, download: false },
};

/** Only hashes that look like routes navigate; in-page anchors are left alone. */
const routeFromHash = () => {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h.split('?')[0] : null;
};

function Router() {
  const [path, setPath] = useState(() => routeFromHash() ?? '/');
  const { lang } = useLang();

  useEffect(() => {
    const onHash = () => {
      const next = routeFromHash();
      if (next === null) return;
      setPath(next);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const brand = lang === 'ar' ? 'تجربة Tajribah' : 'Tajribah';
    const title = TITLES[path];
    document.title = !title ? brand : path === '/' ? pick(title, lang) : `${pick(title, lang)} | ${brand}`;
  }, [path, lang]);

  const Page = ROUTES[path] ?? NotFound;
  return <Page />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SiteEnvContext.Provider value={ENV}>
      <LangProvider initial={readStoredLang() ?? 'ar'}>
        <Router />
      </LangProvider>
    </SiteEnvContext.Provider>
  </StrictMode>,
);
