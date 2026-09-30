'use client';

/**
 * P0.17 — the dashboard shell: sidebar, topbar, tenant switcher, language toggle.
 *
 * The sidebar hides an item the role cannot use, and shows a locked item the *plan* does
 * not include — hiding a feature the merchant could buy is how you sell nothing.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BarChart3, Box, CreditCard, Code2, Home, KeyRound, Link2, Webhook, Lock, Menu, Package, QrCode,
  Scan, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal, Users, ChevronDown, X, LogOut, Eye, Megaphone, Check, Plus,
} from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { ApiError, currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useResource } from '@/lib/data';
import { RequireSession } from './require-session';
import { CommandPalette } from './command-palette';
import { NotificationBell } from './notifications';
import { navGroupsFor } from '@/lib/nav';
import { ROLE_LABEL, ROLE_PERMISSIONS } from '@/lib/permissions';
import { planByCode } from '@/lib/plans';
import type { TenantSummary } from '@/lib/view-models';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';

const ICONS: Record<string, typeof Home> = {
  home: Home, package: Package, box: Box, scan: Scan, sliders: SlidersHorizontal,
  code: Code2, qr: QrCode, chart: BarChart3, link: Link2, users: Users,
  card: CreditCard, gear: Settings, key: KeyRound, webhook: Webhook,
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
  // Same rule as the palette. Not a security boundary: the API refuses what the role lacks.
  const role = currentStore(auth.me)?.role ?? 'viewer';
  const groups = navGroupsFor(ROLE_PERMISSIONS[role] ?? []);

  const signOut = async () => {
    await auth.logout();
    env.navigate('/login');
  };

  return (
    <nav className="sidebar" data-open={open ? 'true' : 'false'} aria-label={t('التنقل الرئيسي', 'Main navigation')}>
      <Logo light />

      {groups.map((group) => (
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
        {auth.me?.user.isStaff && (
          <AppLink href="/admin" className="side-link"><ShieldAlert size={17} aria-hidden /><span>{t('لوحة الموظفين', 'Staff console')}</span></AppLink>
        )}
        {/* Personal, for every role: not a store screen, so not in the permission-filtered nav. */}
        <AppLink href="/dashboard/security" className="side-link" aria-current={env.path === '/dashboard/security' ? 'page' : undefined}>
          <ShieldCheck size={17} aria-hidden />
          <span>{t('أمان تسجيل الدخول', 'Sign-in security')}</span>
        </AppLink>
        <button type="button" className="side-link side-signout" onClick={() => void signOut()}>
          <LogOut size={17} aria-hidden />
          <span>{t('تسجيل الخروج', 'Sign out')}</span>
        </button>
      </div>
    </nav>
  );
}

/** P2.11: a store whose trial or subscription ended can read everything but change nothing — say so, and the way out. */
const DISMISSED_KEY = 'tajribah-dismissed-announcements';
const readDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]; } catch { return []; } };

/** A13 (T23): notices Tajribah publishes to every store — dismissible, remembered in this browser only. */
function AnnouncementBanner() {
  const { t, pick } = useLang();
  const { data } = useResource((s) => s.announcements(), []);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const shown = (data ?? []).filter((a) => !dismissed.includes(a.id));
  if (!shown.length) return null;
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* private window: dismissed for this visit only */ }
  };
  return (
    <>
      {shown.map((a) => (
        <div key={a.id} className={`notice announcement ${a.level}`} role="status">
          <Megaphone size={18} aria-hidden />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{pick(a.title)}</strong>
            {a.body && <p>{pick(a.body)}</p>}
          </div>
          {a.link && <AppLink href={a.link} className="btn btn-ghost btn-sm">{t('التفاصيل', 'Details')}</AppLink>}
          <button type="button" className="icon-btn" onClick={() => dismiss(a.id)} aria-label={t('إخفاء', 'Dismiss')}><X size={16} /></button>
        </div>
      ))}
    </>
  );
}

/** A4b: a staff member is looking at this store's dashboard — say so on every screen, with Stop. */
function StaffViewBanner({ store }: { store: TenantSummary | null }) {
  const { t, lang } = useLang();
  const auth = useAuth();
  const env = useEnv();
  const [busy, setBusy] = useState(false);
  const view = auth.me?.staffView;
  if (!view) return null;
  const stop = async () => {
    setBusy(true);
    try { await auth.admin.endView(); env.navigate(`/admin/stores/${view.storeId}`); } finally { setBusy(false); }
  };
  return (
    <div className="notice staff-view" role="status">
      <Eye size={18} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{t(`عرض الموظفين لمتجر ${store?.name ?? ''}`, `Staff view of ${store?.name ?? 'this store'}`)}</strong>
        <p>{t(`للاطلاع فقط — لا يمكن تغيير شيء. ينتهي ${formatDateTime(view.until, lang)}، ويرى المتجر ذلك في سجل نشاطه.`, `Read-only — nothing can be changed. Ends ${formatDateTime(view.until, lang)}; the store sees it in its activity.`)}</p>
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={stop} disabled={busy}>{t('إنهاء العرض', 'Stop viewing')}</button>
    </div>
  );
}

function ReadOnlyBanner({ store }: { store: TenantSummary | null }) {
  const { t, lang } = useLang();
  if (!store?.readOnly) return null;
  const ended = store.readOnly === 'trial_ended' && store.trialEndsAt ? formatDate(store.trialEndsAt, lang) : null;
  return (
    <div className="notice" role="status">
      <Lock size={18} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>
          {store.readOnly === 'trial_ended'
            ? t(`انتهت التجربة المجانية${ended ? ` في ${ended}` : ''}`, `The free trial ended${ended ? ` on ${ended}` : ''}`)
            : t('انتهى الاشتراك', 'The subscription has ended')}
        </strong>
        <p>{t(
          'متجرك الآن للاطلاع فقط: لا يُحذف شيء، لكن لا يمكن إجراء تغييرات حتى تختار باقة.',
          'Your store is read-only for now: nothing is deleted, but changes are paused until you choose a plan.',
        )}</p>
      </div>
      <AppLink href="/dashboard/billing" className="btn btn-accent btn-sm">{t('اختر باقة', 'Choose a plan')}</AppLink>
    </div>
  );
}

/**
 * P6 — the store switcher: every store this person belongs to, their role and plan in each. Moving
 * to another store is a **full page load** of its home, so no screen can go on showing one store's
 * data under another store's name.
 */
function TenantSwitcher({ tenant }: { tenant: TenantSummary | null }) {
  const { t, pick } = useLang();
  const auth = useAuth();
  const env = useEnv();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<{ ar: string; en: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);
  if (!tenant) return null;
  const stores = auth.me?.tenants ?? [];
  const go = async (id: string) => {
    if (id === tenant.id) { setOpen(false); return; }
    setBusy(id); setFailed(false);
    try {
      await auth.switchTenant(id);
      if (auth.live) window.location.assign(env.toHref('/dashboard'));
      else { setOpen(false); env.navigate('/dashboard'); }
    } catch {
      setFailed(true);
    } finally { setBusy(null); }
  };
  // T30: another store, on its own 14-day trial; the session moves to it and its setup starts.
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy('new'); setAddError(null);
    try {
      await auth.addStore(newName.trim());
      if (auth.live) window.location.assign(env.toHref('/dashboard'));
      else { setOpen(false); env.navigate('/dashboard'); }
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      setAddError(status === 403 ? { ar: 'أكّد بريدك الإلكتروني أولًا — أرسلنا لك رابطًا.', en: 'Confirm your email address first — we sent you a link.' }
        : status === 429 ? { ar: 'أضفت عدة متاجر اليوم. حاول غدًا.', en: 'You have added several stores today. Try again tomorrow.' }
          : status === 409 ? { ar: 'المعاينة فيها متجر واحد — إضافة المتاجر تعمل في لوحة التحكم الحقيقية.', en: 'The preview has one store — adding stores works in the live dashboard.' }
            : { ar: 'تعذّرت إضافة المتجر. حاول مرة أخرى.', en: 'The store could not be added. Try again.' });
    } finally { setBusy(null); }
  };
  return (
    <div className="tenant-menu" ref={box}>
      <button type="button" className="tenant-switch" aria-haspopup="true" aria-expanded={open} onClick={() => { setOpen((v) => !v); setFailed(false); }}>
        <span className="tenant-avatar" aria-hidden>{tenant.name.trim().slice(0, 2)}</span>
        <span className="tenant-name">{tenant.name}</span>
        <ChevronDown size={15} aria-hidden />
        <span className="sr-only">{t('تبديل المتجر', 'Switch store')}</span>
      </button>
      {open && (
        <div className="tenant-panel" role="region" aria-label={t('متاجرك', 'Your stores')}>
          <strong className="tenant-panel-head">{t('متاجرك', 'Your stores')}</strong>
          <ul>
            {stores.map((s) => {
              const current = s.id === tenant.id;
              const plan = planByCode(s.plan);
              return (
                <li key={s.id}>
                  <button type="button" className={`tenant-item${current ? ' is-current' : ''}`} aria-current={current ? 'true' : undefined}
                    disabled={busy !== null} onClick={() => void go(s.id)}>
                    <span className="tenant-avatar" aria-hidden>{s.name.trim().slice(0, 2)}</span>
                    <span className="tenant-item-text">
                      <span className="tenant-item-name">{s.name}</span>
                      <span className="tenant-item-meta">
                        {pick(ROLE_LABEL[s.role as keyof typeof ROLE_LABEL] ?? { ar: s.role, en: s.role })}
                        {plan ? ` · ${pick(plan.name)}` : ''}
                        {s.status === 'suspended' ? ` · ${t('موقوف', 'Suspended')}` : s.readOnly ? ` · ${t('للقراءة فقط', 'Read-only')}` : ''}
                      </span>
                    </span>
                    {current ? <Check size={15} aria-hidden /> : busy === s.id ? <span className="tenant-item-busy">{t('جارٍ…', '…')}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {adding ? (
            <form className="tenant-add" onSubmit={add}>
              <label htmlFor="new-store-name">{t('اسم المتجر الجديد', 'New store name')}</label>
              <input id="new-store-name" value={newName} maxLength={120} autoFocus onChange={(e) => setNewName(e.target.value)} />
              <span className="tenant-item-meta">{t('يبدأ بتجربة مجانية لمدة 14 يومًا، وأنت مالكه.', 'It starts on its own 14-day free trial, with you as its owner.')}</span>
              <div className="tenant-add-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy !== null || !newName.trim()}>{busy === 'new' ? t('جارٍ الإنشاء…', 'Creating…') : t('أنشئ المتجر', 'Create the store')}</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setAdding(false); setAddError(null); }}>{t('إلغاء', 'Cancel')}</button>
              </div>
              {addError && <p className="tenant-panel-note" role="alert" style={{ padding: 0 }}>{pick(addError)}</p>}
            </form>
          ) : auth.me?.ssoStoreId ? null : ( // P8: a single sign-on session opens its own store only
            <button type="button" className="tenant-add-open" onClick={() => setAdding(true)} disabled={busy !== null}>
              <Plus size={15} aria-hidden /> {t('أضف متجرًا', 'Add a store')}
            </button>
          )}
          {failed && <p className="tenant-panel-note" role="alert">{t('تعذّر الانتقال إلى هذا المتجر. ربما لم تعد عضوًا فيه.', 'Could not open that store. You may no longer be a member.')}</p>}
        </div>
      )}
    </div>
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
            <CommandPalette />
            <LangToggle />
            <NotificationBell />
            <TenantSwitcher tenant={store} />
          </div>
        </header>

        <main className="page" id="main">
          <StaffViewBanner store={store} />
          <AnnouncementBanner />
          <ReadOnlyBanner store={store} />
          <RequireSession>{children}</RequireSession>
        </main>
      </div>
    </div>
  );
}
