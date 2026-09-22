'use client';

/**
 * P0.17 — the dashboard shell: sidebar, topbar, tenant switcher, language toggle.
 *
 * The sidebar hides an item the role cannot use, and shows a locked item the *plan* does
 * not include — hiding a feature the merchant could buy is how you sell nothing.
 */
import { useState, type ReactNode } from 'react';
import {
  BarChart3, Box, CreditCard, Code2, Home, Link2, Lock, Menu, Package, QrCode,
  Scan, Settings, SlidersHorizontal, Users, ChevronDown, Bell, X, LogOut,
} from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { RequireSession } from './require-session';
import { DASHBOARD_NAV } from '@/lib/nav';
import { planByCode } from '@/lib/plans';
import type { TenantSummary } from '@/lib/view-models';
import { formatRelative } from '@/lib/format';

const ICONS: Record<string, typeof Home> = {
  home: Home, package: Package, box: Box, scan: Scan, sliders: SlidersHorizontal,
  code: Code2, qr: QrCode, chart: BarChart3, link: Link2, users: Users,
  card: CreditCard, gear: Settings,
};

export function Logo({ light = false }: { light?: boolean }) {
  const env = useEnv();
  const { t } = useLang();
  return (
    <AppLink href="/dashboard" className="side-brand" aria-label={t('تجربة — لوحة التحكم', 'Tajribah — dashboard')}>
      <img
        src={env.asset(light ? '/brand/tajribah-wordmark-light.png' : '/brand/tajribah-wordmark.png')}
        alt="Tajribah تجربة"
      />
      <span className="side-brand-sub">{t('لوحة التحكم', 'Dashboard')}</span>
    </AppLink>
  );
}

function Sidebar({ tenant, open, onClose }: { tenant: TenantSummary | null; open: boolean; onClose: () => void }) {
  const { t, pick, lang } = useLang();
  const env = useEnv();
  const auth = useAuth();
  const plan = tenant ? planByCode(tenant.plan) : null;

  const signOut = async () => {
    await auth.logout();
    env.navigate('/login');
  };

  return (
    <nav className="sidebar" data-open={open ? 'true' : 'false'} aria-label={t('التنقل الرئيسي', 'Main navigation')}>
      <Logo light />

      {DASHBOARD_NAV.map((group) => (
        <div className="side-group" key={group.label.en}>
          <h2>{pick(group.label)}</h2>
          {group.items.map((item) => {
            const Icon = ICONS[item.icon] ?? Home;
            const locked = item.feature ? !plan?.features.includes(item.feature) : false;
            const active = env.path === item.href
              || (item.href !== '/dashboard' && env.path.startsWith(`${item.href}/`));
            return (
              <AppLink
                key={item.id}
                href={locked ? '/dashboard/billing' : item.href}
                className="side-link"
                aria-current={active ? 'page' : undefined}
                title={locked ? t('غير متاح في باقتك الحالية', 'Not included in your current plan') : undefined}
                onClick={onClose}
              >
                <Icon size={17} aria-hidden />
                <span>{pick(item.label)}</span>
                {locked && <Lock className="lock" size={13} aria-hidden />}
              </AppLink>
            );
          })}
        </div>
      ))}

      <div className="side-foot">
        {tenant?.status === 'trial' && tenant.trialEndsAt && (
          <div className="trial-card">
            <strong>{t('الفترة التجريبية', 'Trial period')}</strong>
            {t(
              `تنتهي ${formatRelative(tenant.trialEndsAt, lang)} · باقة ${plan ? pick(plan.name) : ''}`,
              `Ends ${formatRelative(tenant.trialEndsAt, lang)} · ${plan ? pick(plan.name) : ''} plan`,
            )}
            <AppLink href="/dashboard/billing" className="btn btn-accent btn-sm">
              {t('اختر باقة', 'Choose a plan')}
            </AppLink>
          </div>
        )}
        <button type="button" className="side-link side-signout" onClick={() => void signOut()}>
          <LogOut size={17} aria-hidden />
          <span>{t('تسجيل الخروج', 'Sign out')}</span>
        </button>
      </div>
    </nav>
  );
}

function TenantSwitcher({ tenant }: { tenant: TenantSummary | null }) {
  const { t } = useLang();
  if (!tenant) return null;
  const initials = tenant.name.trim().slice(0, 2);
  return (
    <button type="button" className="tenant-switch" aria-haspopup="listbox">
      <span className="tenant-avatar" aria-hidden>{initials}</span>
      <span className="tenant-name">{tenant.name}</span>
      <ChevronDown size={15} aria-hidden />
      <span className="sr-only">{t('تبديل المتجر', 'Switch store')}</span>
    </button>
  );
}

export function LangToggle() {
  const { lang, toggle } = useLang();
  return (
    <button type="button" className="lang-toggle" onClick={toggle}
      aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}>
      {lang === 'ar' ? 'EN' : 'ع'}
    </button>
  );
}

export type Crumb = { label: string; href?: string };

export function Shell({ tenant, crumbs = [], children }: {
  tenant: TenantSummary | null;
  crumbs?: Crumb[];
  children: ReactNode;
}) {
  const { t } = useLang();
  const env = useEnv();
  // Open *on a path*: navigating anywhere else closes the drawer without an effect — the
  // classic "why is the menu still here" bug, avoided by construction.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === env.path;
  const setMenuOpen = (open: boolean | ((was: boolean) => boolean)) =>
    setMenuOpenOn((typeof open === 'function' ? open(menuOpen) : open) ? env.path : null);
  // Pages that already loaded the store pass it; every other page takes it from the session
  // — no extra request, and none at all before the session is known.
  const { me } = useAuth();
  const store = tenant ?? currentStore(me);


  return (
    <div className="app-shell">
      <Sidebar tenant={store} open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn" data-mobile-only
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? t('إغلاق القائمة', 'Close menu') : t('فتح القائمة', 'Open menu')}>
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          <nav className="crumbs" aria-label={t('مسار التنقل', 'Breadcrumb')}>
            {crumbs.map((crumb, index) => (
              <span key={crumb.label} className="crumb">
                {index > 0 && <span aria-hidden>/</span>}
                {crumb.href && index < crumbs.length - 1
                  ? <AppLink href={crumb.href}>{crumb.label}</AppLink>
                  : <span aria-current="page">{crumb.label}</span>}
              </span>
            ))}
          </nav>

          <div className="top-actions">
            {env.demo && (
              <span className="demo-flag" title={t('بيانات تجريبية للعرض فقط', 'Seeded data, for preview only')}>
                {t('بيانات تجريبية', 'Demo data')}
              </span>
            )}
            <LangToggle />
            <button type="button" className="icon-btn" aria-label={t('الإشعارات', 'Notifications')}>
              <Bell size={17} />
            </button>
            <TenantSwitcher tenant={store} />
          </div>
        </header>

        <main className="page" id="main"><RequireSession>{children}</RequireSession></main>
      </div>
    </div>
  );
}
