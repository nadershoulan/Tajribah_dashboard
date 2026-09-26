'use client';

/**
 * P0.20 — who is signed in, for every screen.
 *
 * Two providers behind one hook, the same split as `DataProvider`: `AuthProvider` talks to
 * the real API through `ApiClient`; `DemoAuthProvider` is the static preview, permanently
 * signed in as the demo store, and says so rather than pretending to sign anyone in.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ApiClient, MeResponse, RegisterBody } from './api-client';
import { DEMO_DASHBOARD } from './demo-data';

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

export type AuthApi = {
  status: AuthStatus;
  me: MeResponse | null;
  /** False in the preview: the forms explain there is no server instead of submitting. */
  live: boolean;
  login(email: string, password: string): Promise<void>;
  register(body: RegisterBody): Promise<{ slugNeedsConfirmation: boolean }>;
  logout(): Promise<void>;
  switchTenant(tenantId: string): Promise<void>;
  /** P1.24. Rejects with `ApiError` 404 for a used, expired, revoked or someone-else's link. */
  acceptInvitation(token: string): Promise<void>;
  /** P1.2. Always resolves: whether the address has an account is not the caller's to learn. */
  requestPasswordReset(email: string, locale: 'ar' | 'en'): Promise<void>;
  /** P1.2. Ends every session, this one included. `ApiError` 422 for a bad or used link. */
  resetPassword(token: string, password: string): Promise<void>;
  /** P1.2. `ApiError` 422 for an expired, used or unknown link. */
  verifyEmail(token: string): Promise<void>;
  resendVerification(): Promise<{ sent: boolean; alreadyVerified: boolean }>;
};

const AuthContext = createContext<AuthApi | null>(null);

export function useAuth(): AuthApi {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth() outside an AuthProvider');
  return auth;
}

export function AuthProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; me: MeResponse | null }>({ status: 'loading', me: null });

  const load = useCallback(async () => {
    try {
      setState({ status: 'signed-in', me: await client.me() });
    } catch {
      setState({ status: 'signed-out', me: null });
    }
  }, [client]);

  useEffect(() => {
    let live = true;
    // A reload has no access token (memory only); the refresh cookie decides.
    client.restore().then((ok) => {
      if (!live) return;
      if (ok) void load(); else setState({ status: 'signed-out', me: null });
    });
    // Any call that ends in a final 401 (revoked elsewhere, token reuse) signs the UI out too.
    const off = client.onChange((signedIn) => { if (!signedIn && live) setState({ status: 'signed-out', me: null }); });
    return () => { live = false; off(); };
  }, [client, load]);

  const api = useMemo<AuthApi>(() => ({
    ...state,
    live: true,
    login: async (email, password) => { await client.login(email, password); await load(); },
    register: async (body) => { const result = await client.register(body); await load(); return result; },
    logout: async () => { await client.logout(); setState({ status: 'signed-out', me: null }); },
    switchTenant: async (tenantId) => { await client.switchTenant(tenantId); await load(); },
    acceptInvitation: async (token) => { await client.acceptInvitation(token); await load(); },
    requestPasswordReset: (email, locale) => client.requestPasswordReset(email, locale),
    resetPassword: async (token, password) => {
      await client.confirmPasswordReset(token, password);
      setState({ status: 'signed-out', me: null });
    },
    // Signed in (the same browser): re-read `me` so "confirm your email" disappears at once.
    verifyEmail: async (token) => { await client.verifyEmail(token); if (client.signedIn) await load(); },
    resendVerification: async () => {
      const result = await client.resendVerification();
      if (result.alreadyVerified) await load();
      return result;
    },
  }), [state, client, load]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

/** The preview: signed in as the seeded demo store, and every action is a no-op. */
export function DemoAuthProvider({ children }: { children: ReactNode }) {
  const tenant = DEMO_DASHBOARD.tenant;
  const api = useMemo<AuthApi>(() => ({
    status: 'signed-in',
    live: false,
    me: {
      user: { id: 'demo', email: 'demo@example.com', fullName: 'Demo', emailVerified: true, locale: 'ar' },
      currentTenantId: tenant.id,
      tenants: [{
        id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, role: tenant.role,
        plan: tenant.plan, trialEndsAt: tenant.trialEndsAt, logoUrl: tenant.logoUrl,
      }],
    },
    login: async () => {},
    register: async () => ({ slugNeedsConfirmation: false }),
    logout: async () => {},
    switchTenant: async () => {},
    acceptInvitation: async () => {},
    requestPasswordReset: async () => {},
    resetPassword: async () => {},
    verifyEmail: async () => {},
    resendVerification: async () => ({ sent: false, alreadyVerified: true }),
  }), [tenant]);
  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}
