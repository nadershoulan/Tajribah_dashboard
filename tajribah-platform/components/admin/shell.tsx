'use client';

/**
 * A1 — the admin console's frame. Unmistakably not the merchant dashboard (a dark bar that
 * says "staff console — every action is logged"), and guarded twice: the session
 * (`RequireSession`) and the server's staff check (`/api/admin/whoami`). Not staff → the same
 * "page not found" anyone sees for a wrong address; staff without two-step sign-in → the way
 * to turn it on. The server refuses the same people on every admin endpoint regardless.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowLeft, Box, Cpu, FileLock2, Globe, LayoutDashboard, LifeBuoy, Megaphone, PenTool, Receipt, ScrollText, ShieldAlert, Store, Tags, TicketPercent, Users } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { LangToggle } from '@/components/dashboard/chrome';
import { RequireSession } from '@/components/dashboard/require-session';
import { Loading, Panel } from '@/components/dashboard/ui';
import NotFound from '@/components/pages/NotFound';

type Access = { state: 'checking' } | { state: 'staff'; email: string } | { state: 'not-found' } | { state: 'needs-2fa' } | { state: 'error'; message: string };

const NAV = [
  { href: '/admin', icon: LayoutDashboard, label: { ar: 'نظرة عامة', en: 'Overview' } },
  { href: '/admin/support', icon: LifeBuoy, label: { ar: 'الدعم', en: 'Support' } },
  { href: '/admin/stores', icon: Store, label: { ar: 'المتاجر', en: 'Stores' } },
  { href: '/admin/people', icon: Users, label: { ar: 'الأشخاص', en: 'People' } },
  { href: '/admin/plans', icon: Tags, label: { ar: 'الباقات', en: 'Plans' } },
  { href: '/admin/coupons', icon: TicketPercent, label: { ar: 'الكوبونات', en: 'Coupons' } },
  { href: '/admin/announcements', icon: Megaphone, label: { ar: 'الإعلانات', en: 'Announcements' } },
  { href: '/admin/site', icon: Globe, label: { ar: 'الموقع', en: 'Website' } },
  { href: '/admin/billing', icon: Receipt, label: { ar: 'الفوترة', en: 'Billing' }, also: ['/admin/invoices/'] },
  { href: '/admin/operations', icon: Activity, label: { ar: 'التشغيل', en: 'Operations' } },
  { href: '/admin/qa', icon: Box, label: { ar: 'مراجعة النماذج', en: 'Model review' } },
  { href: '/admin/professional', icon: PenTool, label: { ar: 'النماذج الاحترافية', en: 'Professional models' } },
  { href: '/admin/ai', icon: Cpu, label: { ar: 'عمليات الذكاء الاصطناعي', en: 'AI operations' } },
  { href: '/admin/compliance', icon: FileLock2, label: { ar: 'الامتثال', en: 'Compliance' } },
  { href: '/admin/audit', icon: ScrollText, label: { ar: 'سجل الموظفين', en: 'Staff activity' } },
];

export function AdminShell({ title, children }: { title: string; children: ReactNode }) {
  return <RequireSession><Guarded title={title}>{children}</Guarded></RequireSession>;
}

function Guarded({ title, children }: { title: string; children: ReactNode }) {
  const { t, pick } = useLang();
  const auth = useAuth();
  const env = useEnv();
  const [access, setAccess] = useState<Access>({ state: 'checking' });
  const nav = useRef<HTMLElement>(null);
  // On a phone the nav is one scrolling row: keep the current section in sight.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [env.path, access.state]);

  useEffect(() => {
    let live = true;
    auth.admin.whoami().then(
      (me) => { if (live) setAccess({ state: 'staff', email: me.email }); },
      (error) => {
        if (!live) return;
        if (error instanceof ApiError && error.status === 404) setAccess({ state: 'not-found' });
        else if (error instanceof ApiError && error.status === 403) setAccess({ state: 'needs-2fa' });
        else setAccess({ state: 'error', message: (error as Error).message });
      },
    );
    return () => { live = false; };
  }, [auth.admin]);

  if (access.state === 'checking') return <div className="page"><Loading rows={3} /></div>;
  if (access.state === 'not-found') return <NotFound />;

  return (
    <div className="admin-shell">
      <header className="admin-bar">
        <strong>{t('لوحة موظفي تجربة', 'Tajribah staff console')}</strong>
        <span className="admin-warn"><ShieldAlert size={15} aria-hidden />{t('كل إجراء هنا يُسجَّل', 'Every action here is logged')}</span>
        <span className="admin-who" dir="ltr">{access.state === 'staff' ? access.email : ''}</span>
        <LangToggle />
        <AppLink href="/dashboard" className="btn btn-ghost btn-sm"><ArrowLeft size={14} aria-hidden />{t('لوحة المتجر', 'Store dashboard')}</AppLink>
      </header>
      <div className="admin-body">
        <nav ref={nav} className="admin-nav" aria-label={t('أقسام لوحة الموظفين', 'Staff console sections')}>
          {NAV.map((item) => (
            <AppLink key={item.href} href={item.href} className="side-link" aria-current={env.path === item.href || (item.href !== '/admin' && env.path.startsWith(`${item.href}/`)) || item.also?.some((prefix) => env.path.startsWith(prefix)) ? 'page' : undefined}>
              <item.icon size={17} aria-hidden /><span>{pick(item.label)}</span>
            </AppLink>
          ))}
        </nav>
        <main className="page" id="main">
          <h1 className="admin-title">{title}</h1>
          {access.state === 'needs-2fa' && (
            <Panel title={t('التحقق بخطوتين مطلوب', 'Two-step sign-in is required')}>
              <p style={{ marginTop: 0 }}>{t(
                'حسابات الموظفين لا تفتح لوحة الموظفين دون التحقق بخطوتين: كلمة المرور وحدها لا تكفي هنا.',
                'Staff accounts cannot open the staff console without two-step sign-in: a password alone is not enough here.',
              )}</p>
              <AppLink href="/dashboard/security" className="btn btn-primary">{t('فعّل التحقق بخطوتين', 'Turn on two-step sign-in')}</AppLink>
            </Panel>
          )}
          {access.state === 'error' && <Panel><p style={{ margin: 0 }}>{access.message}</p></Panel>}
          {access.state === 'staff' && children}
        </main>
      </div>
    </div>
  );
}
