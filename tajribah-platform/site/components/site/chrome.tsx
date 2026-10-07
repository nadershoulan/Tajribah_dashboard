'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Globe, Menu, X } from 'lucide-react';
import { useLang, pick } from '@site/lib/i18n';
import { SiteLink, useSiteEnv } from '@site/lib/site-env';
import { ConsentBanner, ConsentLink } from './consent';
import { COMPANY, FOOTER, NAV } from '@site/lib/site';

/** The Tajribah lockup. Always a link home — the logo is the site's front door. */
export function Logo({ light = false, className = '' }: { light?: boolean; className?: string }) {
  const { asset } = useSiteEnv();
  const { t } = useLang();
  return (
    <SiteLink href="/" className={'logo ' + className} aria-label={t('تجربة — الصفحة الرئيسية', 'Tajribah — home')}>
      <img src={asset(light ? '/brand/tajribah-wordmark-light.png' : '/brand/tajribah-wordmark.png')} alt="تجربة Tajribah" width={420} height={89} />
    </SiteLink>
  );
}

/** Forward-pointing arrow that respects reading direction. */
export function Forward({ size = 18 }: { size?: number }) {
  const { dir } = useLang();
  return dir === 'rtl' ? <ArrowLeft size={size} aria-hidden /> : <ArrowRight size={size} aria-hidden />;
}

export function Header({ current }: { current?: string }) {
  const { lang, t, toggle } = useLang();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  return (
    <header className="site-head">
      <div className="wrap head-row">
        <Logo />
        <nav className="nav" aria-label={t('الرئيسية', 'Main')}>
          {NAV.map((n) => (
            <SiteLink key={n.href} href={n.href} aria-current={current === n.href ? 'page' : undefined}>{pick(n.label, lang)}</SiteLink>
          ))}
        </nav>
        <div className="head-actions">
          <button className="lang-btn" onClick={toggle} lang={lang === 'ar' ? 'en' : 'ar'}>
            <Globe size={16} aria-hidden />{t('English', 'العربية')}
          </button>
          {/* Nader, 2026-10-08: sign-up in the header too, beside the demo. */}
          <SiteLink href={`${COMPANY.appUrl}/register`} className="btn btn-ghost btn-sm head-cta">{t('إنشاء حساب', 'Sign up')}</SiteLink>
          <SiteLink href="/demo" className="btn btn-primary btn-sm head-cta">{t('جرّب العرض', 'Try the demo')}</SiteLink>
          <button className="menu-btn" aria-expanded={open} aria-controls="mobile-nav" aria-label={t('القائمة', 'Menu')} onClick={() => setOpen(!open)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      <div id="mobile-nav" className="mobile-nav" hidden={!open}>
        <div className="wrap">
          {NAV.map((n) => (
            <SiteLink key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={current === n.href ? 'page' : undefined}>{pick(n.label, lang)}</SiteLink>
          ))}
          <SiteLink href={`${COMPANY.appUrl}/register`} className="btn btn-ghost" onClick={() => setOpen(false)}>{t('إنشاء حساب', 'Sign up')}</SiteLink>
          <SiteLink href="/demo" className="btn btn-primary" onClick={() => setOpen(false)}>{t('جرّب العرض التجريبي', 'Try the live demo')}</SiteLink>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const { lang, t } = useLang();
  const year = 2026;
  return (
    <footer className="site-foot">
      <div className="wrap foot-grid">
        <div className="foot-brand">
          <Logo light />
          <p>{t('تجربة افتراضية ومقارنة بالحجم الحقيقي لمتاجر الساعات والمجوهرات والإكسسوارات. عربية أولًا، ومن دون تطبيق.',
            'Virtual try-on and true-size comparison for watch, jewellery and accessory stores. Arabic-first, no app required.')}</p>
          <a className="foot-mail" href={`mailto:${COMPANY.email}`} dir="ltr">{COMPANY.email}</a>
          <a className="foot-mail" href={`tel:${COMPANY.tel}`} dir="ltr">{COMPANY.phone}</a>
        </div>
        {FOOTER.map((col) => (
          <div key={col.title.en} className="foot-col">
            <h2>{pick(col.title, lang)}</h2>
            <ul>{col.links.map((l) => <li key={l.href}><SiteLink href={l.href}>{pick(l.label, lang)}</SiteLink></li>)}</ul>
          </div>
        ))}
      </div>
      <div className="wrap foot-base">
        {/* Nader, 2026-10-08: the brand only; the company's legal details stay on invoices and the legal pages. */}
        <span>© {year} {t('تجربة', 'Tajribah')}</span>
        <ConsentLink />
      </div>
    </footer>
  );
}

export function Shell({ current, children }: { current?: string; children: ReactNode }) {
  const { t } = useLang();
  return (
    <div className="site">
      {/* focus by script: a #main hash would be read as a route by the static preview */}
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        {t('انتقل إلى المحتوى', 'Skip to content')}
      </a>
      <Header current={current} />
      <main id="main" tabIndex={-1}>{children}</main>
      <Footer />
      <ConsentBanner />
    </div>
  );
}
