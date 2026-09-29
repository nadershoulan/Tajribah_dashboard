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
import Qr from '@/components/pages/Qr';
import AiJobs from '@/components/pages/AiJobs';
import ApiKeys from '@/components/pages/ApiKeys';
import Webhooks from '@/components/pages/Webhooks';
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
import AdminBilling from '@/components/pages/admin/AdminBilling';
import AdminInvoice from '@/components/pages/admin/AdminInvoice';
import AdminOperations from '@/components/pages/admin/AdminOperations';
import AdminQa from '@/components/pages/admin/AdminQa';
import AdminAi from '@/components/pages/admin/AdminAi';
import ModelEditor from '@/components/pages/ModelEditor';
import TryOn from '@/components/pages/TryOn';
import AdminSupport from '@/components/pages/admin/AdminSupport';
import AdminCoupons from '@/components/pages/admin/AdminCoupons';
import AdminCompliance from '@/components/pages/admin/AdminCompliance';
import AdminAnnouncements from '@/components/pages/admin/AdminAnnouncements';
import NotFound from '@/components/pages/NotFound';

export const ROUTES: Record<string, () => ReactElement> = {
  '/dashboard': DashboardHome,
  '/dashboard/onboarding': Onboarding,
  '/dashboard/security': Security,
  '/dashboard/products': Products,
  '/dashboard/models': Models,
  '/dashboard/tryon': TryOn, // MD-070, P5.10
  '/dashboard/connections': Connections,
  '/dashboard/analytics': Analytics,
  '/dashboard/billing': Billing,
  '/dashboard/team': Team,
  '/dashboard/settings': SettingsPage,
  '/dashboard/embed': Embed,
  '/dashboard/ai-jobs': AiJobs, // P6.8
  '/dashboard/api-keys': ApiKeys, // P8
  '/dashboard/webhooks': Webhooks, // P8
  '/dashboard/qr': Qr, // T52: was "page not found" from the sidebar
  '/dashboard/ar-settings': ArSettings,
  '/login': Login,
  '/register': Register,
  // The staff console (Track A).
  '/admin': AdminOverview,
  '/admin/stores': AdminStores,
  '/admin/people': AdminPeople,
  '/admin/plans': AdminPlans,
  '/admin/billing': AdminBilling,
  '/admin/operations': AdminOperations,
  '/admin/qa': AdminQa,
  '/admin/ai': AdminAi,
  '/admin/support': AdminSupport,
  '/admin/coupons': AdminCoupons,
  '/admin/compliance': AdminCompliance,
  '/admin/announcements': AdminAnnouncements,
  '/admin/audit': AdminAudit,
  '/verify-email': VerifyEmail,
  '/reset-password': ResetPassword,
};

/** Routes with an id in them: the screen reads the id from the path itself. */
const PATTERNS: [RegExp, () => ReactElement][] = [
  [/^\/dashboard\/products\/(?!new$)[^/]+$/, ProductDetail],
  [/^\/dashboard\/models\/[^/]+$/, ModelEditor], // P3.8
  [/^\/invite\/[^/]+$/, InviteAccept],
  [/^\/dashboard\/billing\/invoices\/[^/]+$/, InvoiceView],
  [/^\/admin\/stores\/[^/]+$/, AdminStore],
  [/^\/admin\/people\/[^/]+$/, AdminPerson],
  [/^\/admin\/invoices\/[^/]+$/, AdminInvoice],
];

/** The rendered screen for a path — an element, so no component is chosen during render. */
export function screenFor(path: string): ReactElement {
  const clean = path.replace(/\/$/, '') || '/';
  return createElement(ROUTES[clean] ?? PATTERNS.find(([pattern]) => pattern.test(clean))?.[1] ?? NotFound);
}
