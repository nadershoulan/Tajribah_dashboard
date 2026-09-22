'use client';

/**
 * Every dashboard route → its screen, shared by both shells (the Next app and the static
 * preview), so a screen added here exists in both at once.
 */
import { createElement, type ReactElement } from 'react';
import DashboardHome from '@/components/pages/DashboardHome';
import Products from '@/components/pages/Products';
import Models from '@/components/pages/Models';
import Connections from '@/components/pages/Connections';
import Analytics from '@/components/pages/Analytics';
import Billing from '@/components/pages/Billing';
import Team from '@/components/pages/Team';
import SettingsPage from '@/components/pages/Settings';
import Embed from '@/components/pages/Embed';
import Login from '@/components/pages/Login';
import Register from '@/components/pages/Register';
import NotFound from '@/components/pages/NotFound';

export const ROUTES: Record<string, () => ReactElement> = {
  '/dashboard': DashboardHome,
  '/dashboard/products': Products,
  '/dashboard/models': Models,
  '/dashboard/connections': Connections,
  '/dashboard/analytics': Analytics,
  '/dashboard/billing': Billing,
  '/dashboard/team': Team,
  '/dashboard/settings': SettingsPage,
  '/dashboard/embed': Embed,
  '/login': Login,
  '/register': Register,
};

/** The rendered screen for a path — an element, so no component is chosen during render. */
export function screenFor(path: string): ReactElement {
  return createElement(ROUTES[path.replace(/\/$/, '') || '/'] ?? NotFound);
}
