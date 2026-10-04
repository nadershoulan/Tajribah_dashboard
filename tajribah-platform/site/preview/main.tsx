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
import { StrictMode, useEffect, useState, type ComponentType, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { LangProvider, readStoredLang, useLang } from '@site/lib/i18n';
import { SiteEnvContext, type SiteEnv } from '@site/lib/site-env';
import { pick } from '@site/lib/lang';
import { TITLES } from '@site/lib/site';
import Home from '@site/components/pages/Home';
import Demo from '@site/components/pages/Demo';
import EmbedTryOn from '@site/components/pages/EmbedTryOn';
import HostedPage from '@site/components/pages/HostedPage';
import PartnersPage from '@site/components/pages/Partners';
import Features from '@site/components/pages/Features';
import HowItWorks from '@site/components/pages/HowItWorks';
import Integrations from '@site/components/pages/Integrations';
import Pricing from '@site/components/pages/Pricing';
import About from '@site/components/pages/About';
import Contact from '@site/components/pages/Contact';
import FaqPage from '@site/components/pages/Faq';
import DevelopersPage from '@site/components/pages/Developers';
import NotFound from '@site/components/pages/NotFound';
import { CookiesPage, PrivacyPage, RefundPage, TermsPage, TryOnPrivacyPage } from '@site/components/pages/Legal';
import { SallaPage, ZidPage } from '@site/components/pages/PlatformLanding';
import { BlogIndex, BlogPostPage, CareersPage, HelpArticlePage, HelpIndex, StoriesPage } from '@site/components/pages/Resources';
import { FeaturePageBySlug } from '@site/components/pages/FeatureDetail';
import { featurePage } from '@site/content/features';
import { industry } from '@site/content/industries';
import { IndustriesIndex, IndustryPageBySlug } from '@site/components/pages/Industries';
import { blogPost } from '@site/content/blog';
import { helpArticle } from '@site/content/help';

const ROUTES: Record<string, ComponentType> = {
  '/': Home,
  '/demo': Demo,
  '/embed/try-on': EmbedTryOn, // P5: the frame the storefront opens
  '/features': Features,
  '/industries': IndustriesIndex,
  '/how-it-works': HowItWorks,
  '/integrations': Integrations,
  '/pricing': Pricing,
  '/about': About,
  '/contact': Contact,
  '/faq': FaqPage,
  '/developers': DevelopersPage,
  '/privacy': PrivacyPage,
  '/try-on-privacy': TryOnPrivacyPage,
  '/terms': TermsPage,
  '/refund': RefundPage,
  '/cookies': CookiesPage,
  '/salla': SallaPage,
  '/zid': ZidPage,
  '/help': HelpIndex,
  '/blog': BlogIndex,
  '/customers': StoriesPage,
  '/careers': CareersPage,
  '/partners': PartnersPage,
};

/** Pages with a slug (help articles, blog posts): the component and the title for a path, or null. */
function dynamicRoute(path: string): { element: ReactElement; title: { ar: string; en: string } | null } | null {
  const help = /^\/help\/([a-z0-9-]+)$/.exec(path);
  if (help) return { element: <HelpArticlePage slug={help[1]!} />, title: helpArticle(help[1]!)?.title ?? null };
  const blog = /^\/blog\/([a-z0-9-]+)$/.exec(path);
  if (blog) return { element: <BlogPostPage slug={blog[1]!} />, title: blogPost(blog[1]!)?.title ?? null };
  const feature = /^\/features\/([a-z0-9-]+)$/.exec(path);
  if (feature) return { element: <FeaturePageBySlug slug={feature[1]!} />, title: featurePage(feature[1]!)?.nav ?? null };
  // P1.19: a product's own page — like the try-on frame, not a site page, so it has no title of its own here.
  const hosted = /^\/p\/([^/]+)\/([^/]+)$/.exec(path);
  if (hosted) return { element: <HostedPage store={decodeURIComponent(hosted[1]!)} product={decodeURIComponent(hosted[2]!)} />, title: null };
  const ind = /^\/industries\/([a-z0-9-]+)$/.exec(path);
  if (ind) return { element: <IndustryPageBySlug slug={ind[1]!} />, title: industry(ind[1]!)?.nav ?? null };
  return null;
}

// Static hosts often refuse unknown extensions such as .task. The model is
// fetched as raw bytes, so it ships under a served binary extension instead.
const RENAMED: Record<string, string> = { '/assets/hand-landmarker.task': '/assets/hand-landmarker.task.wasm', '/assets/face-landmarker.task': '/assets/face-landmarker.task.wasm' };

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
    const title = TITLES[path] ?? dynamicRoute(path)?.title;
    document.title = !title ? brand : path === '/' ? pick(title, lang) : `${pick(title, lang)} | ${brand}`;
  }, [path, lang]);

  const Page = ROUTES[path];
  if (Page) return <Page />;
  return dynamicRoute(path)?.element ?? <NotFound />;
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
