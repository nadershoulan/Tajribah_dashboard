/**
 * Dashboard navigation, with the screen IDs from the plan's inventory (§10).
 *
 * The IDs are the traceability mechanism: `grep -r "MD-0" app/` answers "what exists" months
 * from now, and they are kept exactly as the inventory numbers them — renumbering to match a
 * new name buys nothing and breaks every reference.
 */
import type { Bi } from './lang';
import type { Permission } from './permissions';

export type NavItem = {
  id: string;
  href: string;
  label: Bi;
  icon: string;
  /** Hidden when the role lacks it. Not a security boundary — the API is. */
  permission?: Permission;
  /** Hidden until the plan includes it; shown locked rather than removed where it sells. */
  feature?: string;
  badge?: 'soon';
};

export type NavGroup = { label: Bi; items: NavItem[] };

export const DASHBOARD_NAV: NavGroup[] = [
  {
    label: { ar: 'المتجر', en: 'Store' },
    items: [
      { id: 'MD-001', href: '/dashboard', label: { ar: 'الرئيسية', en: 'Home' }, icon: 'home' },
      { id: 'MD-010', href: '/dashboard/products', label: { ar: 'المنتجات', en: 'Products' }, icon: 'package', permission: 'products:read' },
      { id: 'MD-040', href: '/dashboard/models', label: { ar: 'النماذج ثلاثية الأبعاد', en: '3D models' }, icon: 'box', permission: 'models:read' },
      { id: 'MD-070', href: '/dashboard/tryon', label: { ar: 'التجربة الافتراضية', en: 'Virtual try-on' }, icon: 'scan', permission: 'tryon:read', feature: 'virtual_tryon' },
    ],
  },
  {
    label: { ar: 'النشر', en: 'Publishing' },
    items: [
      { id: 'MD-090', href: '/dashboard/ar-settings', label: { ar: 'إعدادات العرض', en: 'AR settings' }, icon: 'sliders', permission: 'ar:read' },
      { id: 'MD-100', href: '/dashboard/embed', label: { ar: 'التركيب في متجرك', en: 'Install in your store' }, icon: 'code', permission: 'ar:read' },
      { id: 'MD-110', href: '/dashboard/qr', label: { ar: 'رموز QR', en: 'QR codes' }, icon: 'qr', permission: 'ar:read' },
    ],
  },
  {
    label: { ar: 'النتائج', en: 'Results' },
    items: [
      { id: 'MD-120', href: '/dashboard/analytics', label: { ar: 'التحليلات', en: 'Analytics' }, icon: 'chart', permission: 'analytics:read' },
    ],
  },
  {
    label: { ar: 'الإعداد', en: 'Setup' },
    items: [
      { id: 'MD-030', href: '/dashboard/connections', label: { ar: 'ربط المتجر', en: 'Store connections' }, icon: 'link', permission: 'connections:read' },
      { id: 'MD-150', href: '/dashboard/team', label: { ar: 'الفريق', en: 'Team' }, icon: 'users', permission: 'team:read' },
      { id: 'MD-160', href: '/dashboard/billing', label: { ar: 'الاشتراك والفواتير', en: 'Billing' }, icon: 'card', permission: 'billing:read' },
      { id: 'MD-170', href: '/dashboard/settings', label: { ar: 'الإعدادات', en: 'Settings' }, icon: 'gear', permission: 'settings:read' },
    ],
  },
];

/** Flat list, for breadcrumbs and the command palette. */
export const ALL_NAV: NavItem[] = DASHBOARD_NAV.flatMap((group) => group.items);

export const navByHref = (href: string): NavItem | undefined =>
  ALL_NAV.find((item) => item.href === href);

/** Titles for routes that are not in the sidebar. */
export const EXTRA_TITLES: Record<string, Bi> = {
  '/dashboard/products/new': { ar: 'منتج جديد', en: 'New product' },
  '/dashboard/onboarding': { ar: 'لنبدأ', en: 'Get started' },
  '/login': { ar: 'تسجيل الدخول', en: 'Sign in' },
  '/register': { ar: 'إنشاء حساب', en: 'Create an account' },
};

/** The screens a role may open, flattened — for the command palette (P1.23). */
export function visibleNav(permissions: readonly string[]): NavItem[] {
  return DASHBOARD_NAV.flatMap((group) => group.items).filter((item) => !item.permission || permissions.includes(item.permission));
}
