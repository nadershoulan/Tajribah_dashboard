'use client';

/**
 * P0.20 — who is signed in, for every screen.
 *
 * Two providers behind one hook, the same split as `DataProvider`: `AuthProvider` talks to
 * the real API through `ApiClient`; `DemoAuthProvider` is the static preview, permanently
 * signed in as the demo store, and says so rather than pretending to sign anyone in.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, type ApiClient, type MeResponse, type RegisterBody, type TwoFactorStatus } from './api-client';
import { matchTotp, newBackupCodes, newTotpSecret, otpauthUrl } from '@/server/core/auth/totp';
import { DEMO_DASHBOARD } from './demo-data';
import type { ConnectionSummary, TeamMemberRow } from './view-models';

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

export type AuthApi = {
  status: AuthStatus;
  me: MeResponse | null;
  /** False in the preview: the forms explain there is no server instead of submitting. */
  live: boolean;
  /** Resolves with a challenge when two-step sign-in still needs a code (P1.2b), else null. */
  login(email: string, password: string): Promise<{ twoFactorChallenge: string } | null>;
  /** P1.2b. `ApiError` 401 `invalid_credentials` for a wrong code, 401 `unauthenticated` for an expired step. */
  completeTwoFactor(challenge: string, code: string): Promise<void>;
  /** P1.2b: the signed-in person's own two-step sign-in. */
  twoFactor: TwoFactorApi;
  /** A1: the staff console. 404 for anyone not staff, 403 for staff without two-step sign-in. */
  admin: AdminApi;
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

export type TwoFactorApi = {
  status(): Promise<TwoFactorStatus>;
  startSetup(password: string): Promise<{ secret: string; otpauthUrl: string }>;
  enable(code: string): Promise<{ backupCodes: string[] }>;
  disable(password: string, code: string): Promise<void>;
  regenerateBackupCodes(password: string): Promise<{ backupCodes: string[] }>;
};

/** A1 — one row of the staff trail (server/modules/admin/access.ts). */
export type StaffTrailRow = {
  id: string; at: string; staff: string; action: string; targetType: string; targetId: string | null;
  storeId: string | null; reason: string | null;
};

/** A2 — server/modules/admin/overview.ts */
export type PlatformOverview = {
  stores: { total: number; trial: number; active: number; pastDue: number; suspended: number; cancelled: number; readOnly: number };
  newStores30d: number;
  trialsEndingIn7d: number;
  subscriptionsByPlan: Record<'starter' | 'growth' | 'pro' | 'enterprise', number>;
  mrrMinor: number;
  arrMinor: number;
  churn30d: number;
  invoicesThisMonth: { count: number; totalMinor: number };
  aiCreditsUsedThisMonth: number;
  asOf: string;
};

/** A3 — server/modules/admin/stores.ts */
export type AdminStoreRow = {
  id: string; name: string; nameAr: string | null; slug: string; status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  plan: 'starter' | 'growth' | 'pro' | 'enterprise'; subscription: string | null; readOnly: 'trial_ended' | 'subscription_ended' | null;
  trialEndsAt: string | null; createdAt: string;
};
type AdminMeter = { used: number; limit: number };
export type AdminStoreDetail = {
  store: AdminStoreRow & { crNumber: string | null; vatNumber: string | null; city: string | null; locale: string };
  usage: Record<'products' | 'team_members' | 'storage_gb' | 'ar_sessions' | 'ai_credits', AdminMeter>;
  credits: { balance: number; usedThisMonth: number };
  invoices: { id: string; number: string; status: string; totalMinor: number; currency: string; issuedAt: string }[];
  connections: ConnectionSummary[];
  members: TeamMemberRow[];
  staffTrail: StaffTrailRow[];
};

/** A4 — server/modules/admin/actions.ts */
export type AdminStoreAction =
  | { type: 'extend_trial'; days: number; reason: string }
  | { type: 'suspend' | 'restore'; reason: string }
  | { type: 'adjust_credits'; delta: number; reason: string };

export type AdminApi = {
  whoami(): Promise<{ email: string; fullName: string }>;
  trail(storeId?: string): Promise<StaffTrailRow[]>;
  overview(): Promise<PlatformOverview>;
  stores(query: { q?: string; status?: string; plan?: string; before?: string }): Promise<{ stores: AdminStoreRow[]; next: string | null }>;
  store(id: string): Promise<AdminStoreDetail>;
  act(id: string, action: AdminStoreAction): Promise<void>;
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
    login: async (email, password) => {
      const pending = await client.login(email, password);
      if (!pending) await load();
      return pending;
    },
    completeTwoFactor: async (challenge, code) => { await client.completeTwoFactor(challenge, code); await load(); },
    admin: {
      whoami: () => client.call('/api/admin/whoami'),
      trail: async (storeId) => (await client.call<{ entries: StaffTrailRow[] }>(`/api/admin/audit${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`)).entries,
      overview: () => client.call('/api/admin/overview'),
      stores: (query) => {
        const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]);
        return client.call(`/api/admin/stores${params.size ? `?${params}` : ''}`);
      },
      store: (id) => client.call(`/api/admin/stores/${encodeURIComponent(id)}`),
      act: async (id, action) => { await client.call(`/api/admin/stores/${encodeURIComponent(id)}/actions`, { body: action }); },
    },
    twoFactor: {
      status: () => client.twoFactorStatus(),
      startSetup: (password) => client.startTwoFactorSetup(password),
      enable: (code) => client.enableTwoFactor(code),
      disable: (password, code) => client.disableTwoFactor(password, code),
      regenerateBackupCodes: (password) => client.regenerateBackupCodes(password),
    },
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

/**
 * The preview's two-step sign-in, for this page load. It runs the real TOTP code
 * (server/core/auth/totp.ts) in the browser, so a code from a real authenticator app works;
 * the preview has no password, so any non-empty one is taken.
 */
const demoTwoFactorState: { secret: string | null; enabled: boolean; codes: string[]; lastStep: number | null } =
  { secret: null, enabled: false, codes: [], lastStep: null };
const refuse = (field: string, message: string) => new ApiError(422, 'validation_failed', 'Validation failed', { [field]: [message] });
const demoTwoFactor: TwoFactorApi = {
  async status() { return { enabled: demoTwoFactorState.enabled, backupCodesLeft: demoTwoFactorState.enabled ? demoTwoFactorState.codes.length : 0 }; },
  async startSetup(password) {
    if (!password) throw refuse('password', 'the password is not right');
    demoTwoFactorState.secret = newTotpSecret();
    return { secret: demoTwoFactorState.secret, otpauthUrl: otpauthUrl({ secret: demoTwoFactorState.secret, account: 'demo@example.com', issuer: 'Tajribah' }) };
  },
  async enable(code) {
    const step = demoTwoFactorState.secret ? await matchTotp(demoTwoFactorState.secret, code, { afterStep: demoTwoFactorState.lastStep }) : null;
    if (step === null) throw refuse('code', 'that code is not right');
    Object.assign(demoTwoFactorState, { enabled: true, lastStep: step, codes: newBackupCodes() });
    return { backupCodes: [...demoTwoFactorState.codes] };
  },
  async disable(password, code) {
    if (!password) throw refuse('password', 'the password is not right');
    const step = demoTwoFactorState.secret ? await matchTotp(demoTwoFactorState.secret, code, { afterStep: demoTwoFactorState.lastStep }) : null;
    const backup = demoTwoFactorState.codes.indexOf(code.trim().toLowerCase());
    if (step === null && backup < 0) throw refuse('code', 'that code is not right');
    Object.assign(demoTwoFactorState, { secret: null, enabled: false, codes: [], lastStep: null });
  },
  async regenerateBackupCodes(password) {
    if (!password) throw refuse('password', 'the password is not right');
    demoTwoFactorState.codes = newBackupCodes();
    return { backupCodes: [...demoTwoFactorState.codes] };
  },
};

const notFound = () => Promise.reject(new ApiError(404, 'not_found', 'page not found'));
const demoAdmin: AdminApi = { whoami: notFound, trail: notFound, overview: notFound, stores: notFound, store: notFound, act: notFound };

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
        plan: tenant.plan, trialEndsAt: tenant.trialEndsAt, logoUrl: tenant.logoUrl, readOnly: tenant.readOnly ?? null,
      }],
    },
    login: async () => null,
    completeTwoFactor: async () => {},
    twoFactor: demoTwoFactor,
    // The preview has no staff: the console answers as it does for any merchant.
    admin: demoAdmin,
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
