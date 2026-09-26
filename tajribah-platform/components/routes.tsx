'use client';

/**
 * Every dashboard route → its screen, shared by both shells (the Next app and the static
 * preview), so a screen added here exists in both at once.
 */
import { createElement, type ReactElement } from 'react';
import DashboardHome from '@/components/pages/DashboardHome';
import Products from '@/components/pages/Products';
import ProductDetail from '@/components/pages/ProductDetail';
import InviteAccept from '@/components/pages/InviteAccept';
import ArSettings from '@/components/pages/ArSettings';
import Models from '@/components/pages/Models';
import Connections from '@/components/pages/Connections';
import Analytics from '@/components/pages/Analytics';
import Billing from '@/components/pages/Billing';
import Team from '@/components/pages/Team';
import SettingsPage from '@/components/pages/Settings';
import Embed from '@/components/pages/Embed';
import Login from '@/components/pages/Login';
import Register from '@/components/pages/Register';
import VerifyEmail from '@/components/pages/VerifyEmail';
import ResetPassword from '@/components/pages/ResetPassword';
import Onboarding from '@/components/pages/Onboarding';
import Security from '@/components/pages/Security';
import InvoiceView from '@/components/pages/InvoiceView';
import AdminAudit from '@/components/pages/admin/AdminAudit';
import AdminOverview from '@/components/pages/admin/AdminOverview';
import AdminStores from '@/components/pages/admin/AdminStores';
import AdminStore from '@/components/pages/admin/AdminStore';
import AdminPeople from '@/components/pages/admin/AdminPeople';
import AdminPerson from '@/components/pages/admin/AdminPerson';
import AdminPlans from '@/components/pages/admin/AdminPlans';
import NotFound from '@/components/pages/NotFound';

export const ROUTES: Record<string, () => ReactElement> = {
  '/dashboard': DashboardHome,
  '/dashboard/onboarding': Onboarding,
  '/dashboard/security': Security,
  '/dashboard/products': Products,
  '/dashboard/models': Models,
  '/dashboard/connections': Connections,
  '/dashboard/analytics': Analytics,
  '/dashboard/billing': Billing,
  '/dashboard/team': Team,
  '/dashboard/settings': SettingsPage,
  '/dashboard/embed': Embed,
  '/dashboard/ar-settings': ArSettings,
  '/login': Login,
  '/register': Register,
  // The staff console (Track A).
  '/admin': AdminOverview,
  '/admin/stores': AdminStores,
  '/admin/people': AdminPeople,
  '/admin/plans': AdminPlans,
  '/admin/audit': AdminAudit,
  '/verify-email': VerifyEmail,
  '/reset-password': ResetPassword,
};

/** Routes with an id in them: the screen reads the id from the path itself. */
const PATTERNS: [RegExp, () => ReactElement][] = [
  [/^\/dashboard\/products\/(?!new$)[^/]+$/, ProductDetail],
  [/^\/invite\/[^/]+$/, InviteAccept],
  [/^\/dashboard\/billing\/invoices\/[^/]+$/, InvoiceView],
  [/^\/admin\/stores\/[^/]+$/, AdminStore],
  [/^\/admin\/people\/[^/]+$/, AdminPerson],
];

/** The rendered screen for a path — an element, so no component is chosen during render. */
export function screenFor(path: string): ReactElement {
  const clean = path.replace(/\/$/, '') || '/';
  return createElement(ROUTES[clean] ?? PATTERNS.find(([pattern]) => pattern.test(clean))?.[1] ?? NotFound);
}
