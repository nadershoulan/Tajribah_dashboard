'use client';

/**
 * P0.20 — the protected-route guard. `Shell` renders every dashboard screen inside it, so a
 * screen cannot forget to be protected.
 *
 * Signed out → `/login?next=<this page>`, and the sign-in screen sends the user back through
 * `safeNext`, so the round trip cannot be turned into an open redirect.
 */
import { useEffect, type ReactNode } from 'react';
import { useEnv } from '@/lib/app-env';
import { useAuth } from '@/lib/auth';
import { Loading } from './ui';

export function loginPathFor(path: string, search = ''): string {
  return `/login?next=${encodeURIComponent(path + search)}`;
}

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const env = useEnv();

  useEffect(() => {
    if (status === 'signed-out') env.navigate(loginPathFor(env.path, env.search));
  }, [status, env]);

  if (status !== 'signed-in') return <Loading rows={4} />;
  return <>{children}</>;
}
