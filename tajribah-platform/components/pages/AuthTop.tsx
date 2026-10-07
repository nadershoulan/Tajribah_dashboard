'use client';

// The row above every sign-in screen (AUTH-001…): the way back to the website, and the language switch.
// Nader, 2026-10-08: the auth pages had no way home.

import { Home } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { LangToggle } from '@/components/dashboard/chrome';

export function AuthTop() {
  const { t } = useLang();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      {/* The website is a different root layout from the dashboard: a client-side <Link> did nothing when clicked
          (found live, 2026-10-08), so this is a plain link and the browser loads the home page whole. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full page load is the point (see above) */}
      <a href="/" className="auth-home" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-2)', textDecoration: 'none', fontSize: 14 }}>
        <Home size={16} aria-hidden />
        {t('العودة إلى الرئيسية', 'Back to home')}
      </a>
      <LangToggle />
    </div>
  );
}
