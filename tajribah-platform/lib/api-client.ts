/**
 * P0.20 — the dashboard's client for `/api/**`.
 *
 *  - The access token lives **in this object's memory** only (never localStorage,
 *    sessionStorage or a readable cookie — all three are readable by any script on the
 *    page). A reload loses it on purpose; `restore()` gets a new one from the httpOnly
 *    refresh cookie, which the browser sends and JavaScript never sees.
 *  - A 401 on an authenticated call triggers **one** refresh and one retry. Concurrent 401s
 *    share the same refresh: the server rotates the refresh token on every use and treats a
 *    reused one as theft, so two parallel refreshes would sign the user out.
 *  - Errors arrive as RFC 9457 problem documents and are thrown as `ApiError`.
 *
 * `fetchImpl` is injectable so the tests can route requests straight into the real handlers.
 */
import type { FieldErrors } from '@/server/core/errors/problem';
import type { PlanCode } from './plans';
import type { TenantSummary } from './view-models';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
    readonly fields?: FieldErrors,
    readonly requestId?: string,
  ) {
    super(detail || code);
  }
}

export type MeResponse = {
  user: { id: string; email: string; fullName: string; emailVerified: boolean; locale: string; isStaff?: boolean };
  currentTenantId: string | null;
  /** A4b: this session is a staff member's read-only view of `storeId` until then. */
  staffView?: { storeId: string; until: string } | null;
  tenants: {
    id: string; slug: string; name: string; status: string; role: string;
    plan: PlanCode; trialEndsAt: string | null; logoUrl: string | null;
    /** P2.11: why the store cannot change things now, or null. */
    readOnly: 'trial_ended' | 'subscription_ended' | null;
  }[];
};

/** The store the session is acting for, in the shape the screens use — or null if none. */
export function currentStore(me: MeResponse | null): TenantSummary | null {
  if (!me) return null;
  const tenant = me.tenants.find((t) => t.id === me.currentTenantId) ?? me.tenants[0];
  if (!tenant) return null;
  return {
    id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan,
    status: tenant.status as TenantSummary['status'], trialEndsAt: tenant.trialEndsAt,
    logoUrl: tenant.logoUrl, role: tenant.role as TenantSummary['role'], readOnly: tenant.readOnly ?? null,
  };
}

type TokenBody = { accessToken: string; expiresIn: number };

export type TwoFactorStatus = { enabled: boolean; backupCodesLeft: number };

export type RegisterBody = {
  email: string; password: string; fullName: string; locale?: 'ar' | 'en'; phone?: string;
} & ({ storeName: string; invitation?: undefined } | { invitation: string; storeName?: undefined }); // T49: joining by invitation makes no store

type Listener = (signedIn: boolean) => void;

export class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly base = '',
  ) {}

  get signedIn(): boolean { return this.accessToken !== null; }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setToken(token: string | null): void {
    const changed = (token === null) !== (this.accessToken === null);
    this.accessToken = token;
    if (changed) for (const listener of this.listeners) listener(token !== null);
  }

  // ------------------------------------------------------------------ transport

  private async send(path: string, init: { method?: string; body?: unknown; auth?: boolean }): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.auth && this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    return this.fetchImpl(`${this.base}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
    });
  }

  private static async fail(response: Response): Promise<never> {
    let problem: { code?: string; title?: string; detail?: string; errors?: FieldErrors; requestId?: string } = {};
    try { problem = await response.json(); } catch { /* not a problem document */ }
    // No detail (a 429, say): the title, which the server wrote in the viewer's language — never the bare code.
    throw new ApiError(response.status, problem.code ?? 'http_error', problem.detail ?? problem.title, problem.errors, problem.requestId);
  }

  /** An authenticated call: one refresh-and-retry on 401, then the error stands. */
  async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let response = await this.send(path, { ...init, auth: true });
    if (response.status === 401 && (await this.refresh())) {
      response = await this.send(path, { ...init, auth: true });
    }
    if (response.status === 401) this.setToken(null);
    if (!response.ok) return ApiClient.fail(response);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  /** P4.8 — like `call`, for a response that is a file (CSV) rather than JSON. */
  async callText(path: string): Promise<string> {
    let response = await this.send(path, { auth: true });
    if (response.status === 401 && (await this.refresh())) response = await this.send(path, { auth: true });
    if (response.status === 401) this.setToken(null);
    if (!response.ok) return ApiClient.fail(response);
    return response.text();
  }

  /** P3.6: a signed-in GET whose answer is a file (the reviewer's model), as a Blob. */
  async callBlob(path: string): Promise<Blob> {
    let response = await this.send(path, { auth: true });
    if (response.status === 401 && (await this.refresh())) response = await this.send(path, { auth: true });
    if (response.status === 401) this.setToken(null);
    if (!response.ok) return ApiClient.fail(response);
    return response.blob();
  }

  /** Exchange the refresh cookie for a new access token. Concurrent callers share one attempt. */
  refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        const response = await this.send('/api/auth/refresh', { method: 'POST' });
        if (!response.ok) { this.setToken(null); return false; }
        this.setToken(((await response.json()) as TokenBody).accessToken);
        return true;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  // ------------------------------------------------------------------ auth

  /** On page load: is there a session behind the cookie? */
  restore(): Promise<boolean> { return this.refresh(); }

  /**
   * The password step. With two-step sign-in on, nothing is signed in yet: the challenge comes
   * back for `completeTwoFactor` (P1.2b).
   */
  async login(email: string, password: string): Promise<{ twoFactorChallenge: string } | null> {
    const response = await this.send('/api/auth/login', { body: { email, password } });
    if (!response.ok) return ApiClient.fail(response);
    const body = await response.json() as TokenBody | { twoFactorRequired: true; challenge: string };
    if ('twoFactorRequired' in body) return { twoFactorChallenge: body.challenge };
    this.setToken(body.accessToken);
    return null;
  }

  /** P1.2b: the code from the authenticator app, or a backup code. */
  async completeTwoFactor(challenge: string, code: string): Promise<void> {
    const response = await this.send('/api/auth/login/2fa', { body: { challenge, code } });
    if (!response.ok) return ApiClient.fail(response);
    this.setToken(((await response.json()) as TokenBody).accessToken);
  }

  // P1.2b — the signed-in person's own two-step sign-in (AUTH-20…22).
  twoFactorStatus(): Promise<TwoFactorStatus> { return this.call('/api/auth/2fa'); }
  startTwoFactorSetup(password: string): Promise<{ secret: string; otpauthUrl: string }> {
    return this.call('/api/auth/2fa/setup', { body: { password } });
  }
  enableTwoFactor(code: string): Promise<{ backupCodes: string[] }> { return this.call('/api/auth/2fa/enable', { body: { code } }); }
  async disableTwoFactor(password: string, code: string): Promise<void> { await this.call('/api/auth/2fa/disable', { body: { password, code } }); }
  regenerateBackupCodes(password: string): Promise<{ backupCodes: string[] }> {
    return this.call('/api/auth/2fa/backup-codes', { body: { password } });
  }

  async register(body: RegisterBody): Promise<{ slugNeedsConfirmation: boolean; tenant: { id: string; slug: string; name: string } }> {
    const response = await this.send('/api/auth/register', { body });
    if (!response.ok) return ApiClient.fail(response);
    const result = await response.json() as TokenBody & { slugNeedsConfirmation: boolean; tenant: { id: string; slug: string; name: string } };
    this.setToken(result.accessToken);
    return result;
  }

  /** Always ends signed out locally, even if the network call fails. */
  async logout(): Promise<void> {
    try {
      await this.send('/api/auth/logout', { method: 'POST' });
    } finally {
      this.setToken(null);
    }
  }

  me(): Promise<MeResponse> { return this.call<MeResponse>('/api/auth/me'); }

  async switchTenant(tenantId: string): Promise<void> {
    const result = await this.call<TokenBody>('/api/auth/switch-tenant', { body: { tenantId } });
    this.setToken(result.accessToken);
  }

  /** P6 (T30): add another store (its own trial); the session then acts for it. */
  async addStore(storeName: string, locale?: 'ar' | 'en'): Promise<string> {
    const result = await this.call<TokenBody & { tenantId: string }>('/api/auth/stores', { body: { storeName, locale } });
    this.setToken(result.accessToken);
    return result.tenantId;
  }

  /** P1.24: join the store that invited this account; the session then acts for it. */
  async acceptInvitation(token: string): Promise<string> {
    const result = await this.call<TokenBody & { tenantId: string }>('/api/invitations/accept', { body: { token } });
    this.setToken(result.accessToken);
    return result.tenantId;
  }

  async requestPasswordReset(email: string, locale: 'ar' | 'en'): Promise<void> {
    const response = await this.send('/api/auth/password-reset', { body: { email, locale } });
    if (!response.ok) return ApiClient.fail(response);
  }

  /** P1.2. The server ends every session on success, so this one ends locally too. */
  async confirmPasswordReset(token: string, password: string): Promise<void> {
    const response = await this.send('/api/auth/password-reset/confirm', { body: { token, password } });
    if (!response.ok) return ApiClient.fail(response);
    this.setToken(null);
  }

  /** P1.2. Needs no session: the link may be opened in another browser than the one signed in. */
  async verifyEmail(token: string): Promise<void> {
    const response = await this.send('/api/auth/verify-email', { body: { token } });
    if (!response.ok) return ApiClient.fail(response);
  }

  /** P1.2. A new link to the signed-in user's own address; older links stop working. */
  resendVerification(): Promise<{ sent: boolean; alreadyVerified: boolean }> {
    return this.call('/api/auth/verify-email/resend', { method: 'POST' });
  }
}
