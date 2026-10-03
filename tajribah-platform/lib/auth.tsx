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
import type { PlanCode, PlanLimits } from './plans';
import type { InvoiceDocument } from './contracts/invoices';
import type { Ga4Picker } from './contracts/settings';
import { ga4PickerFor, noGa4Picker } from './ga4-picker';

/** `?a=1&b=2` from the set values only, or nothing. */
const queryString = (query: Record<string, string | undefined>) => {
  const params = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => !!e[1]));
  return params.size ? `?${params}` : '';
};

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
  /** P8: single sign-on — the store's provider to go to, then back with its code. */
  startSso(store: string): Promise<string>;
  completeSso(code: string, state: string): Promise<void>;
  /** A1: the staff console. 404 for anyone not staff, 403 for staff without two-step sign-in. */
  admin: AdminApi;
  register(body: RegisterBody): Promise<{ slugNeedsConfirmation: boolean }>;
  logout(): Promise<void>;
  switchTenant(tenantId: string): Promise<void>;
  /** P6 (T30): another store for this person, on its own trial; the session moves to it. */
  addStore(storeName: string): Promise<void>;
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
  /** T41: first config published (the refund policy's test) and how many buttons are live now. */
  publishing: { firstAt: string | null; live: number };
};

/** A4 — server/modules/admin/actions.ts */
export type AdminStoreAction =
  | { type: 'extend_trial'; days: number; reason: string }
  | { type: 'suspend' | 'restore'; reason: string }
  | { type: 'adjust_credits'; delta: number; reason: string };

/** A5 — server/modules/admin/users.ts */
export type AdminPersonRow = {
  id: string; email: string; fullName: string; isStaff: boolean; twoFactor: boolean; emailVerified: boolean;
  stores: number; lastLoginAt: string | null; lockedUntil: string | null; createdAt: string;
};
export type AdminPersonDetail = {
  person: AdminPersonRow & { locale: string; phone: string | null; backupCodesLeft: number };
  stores: { id: string; name: string; nameAr: string | null; slug: string; status: AdminStoreRow['status']; role: TeamMemberRow['role']; membership: string }[];
  sessions: { id: string; userAgent: string | null; createdAt: string; lastSeenAt: string | null; expiresAt: string }[];
  staffTrail: StaffTrailRow[];
};
export type AdminPersonAction = { type: 'end_sessions' | 'reset_two_factor'; reason: string };

/** A6 — server/modules/admin/plans.ts */
export type AdminPlan = {
  code: PlanCode; name: string; nameAr: string; currency: string; isPublic: boolean; subscribers: number;
  priceMonthlyMinor: number | null; priceAnnualMinor: number | null;
  limits: PlanLimits; features: Record<string, boolean>;
};
export type AdminPlanChange = {
  priceMonthlyMinor?: number | null; priceAnnualMinor?: number | null;
  limits?: Partial<PlanLimits>; features?: Record<string, boolean>; reason: string;
};

/** A7 — server/modules/admin/billing.ts */
type AdminStoreRef = { id: string; name: string; nameAr: string | null; slug: string };
export type AdminSubscriptionRow = {
  id: string; store: AdminStoreRef; plan: PlanCode; status: 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired';
  cycle: 'monthly' | 'annual'; listPriceMinor: number | null; currency: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; provider: string; createdAt: string;
};
export type AdminInvoiceRow = {
  id: string; number: string; store: AdminStoreRef; status: InvoiceDocument['status'];
  subtotalMinor: number; vatMinor: number; totalMinor: number; currency: string; issuedAt: string | null; paidAt: string | null; zatcaStatus: string | null;
};

/** A11 — server/modules/admin/operations.ts */
type AdminOpsStore = { id: string; name: string; nameAr: string | null } | null;
export type AdminJobRow = { id: string; queue: string; store: AdminOpsStore; state: string; attempts: number; maxAttempts: number; lastError: string | null; claimedBy: string | null; claimedAt: string | null; finishedAt: string | null; createdAt: string };
export type AdminOperations = {
  queues: { queue: string; ready: number; scheduled: number; running: number; dead: number; doneLastDay: number; lagSeconds: number | null }[];
  stuck: AdminJobRow[]; dead: AdminJobRow[];
  webhooks: {
    lastDay: Record<'received' | 'processed' | 'failed' | 'ignored', number>; overdue: number;
    failed: { id: string; provider: string; topic: string; store: AdminOpsStore; attempts: number; error: string | null; createdAt: string }[];
  };
  keys: { currentKeyId: string; previousKeySet: boolean; pending: { connectionTokens: number; authenticatorSecrets: number }; previousKeyRemovable: boolean };
  asOf: string;
};

/** A12 — server/modules/admin/support.ts */
export type AdminTrailEntry = {
  id: string; at: string; source: 'store' | 'staff'; store: { id: string; name: string; nameAr: string | null } | null;
  actorType: string; actor: string | null; action: string; resourceType: string; resourceId: string | null;
  requestId: string | null; fields: string[]; reason: string | null;
};
export type AdminLookup = {
  kind: 'id' | 'email' | 'invoice-number' | 'text';
  stores: { id: string; name: string; nameAr: string | null; slug: string; status: string }[];
  people: { id: string; email: string; fullName: string }[];
  invoices: { id: string; number: string; status: string; store: { id: string; name: string; nameAr: string | null; slug: string; status: string } }[];
  jobs: { id: string; queue: string; state: string; storeId: string | null }[];
  deliveries: { id: string; provider: string; topic: string; status: string; storeId: string }[];
  request: AdminTrailEntry[];
};

/** A13 — server/modules/admin/coupons.ts */
export type AdminCouponFields = {
  code: string; kind: 'percent' | 'fixed' | 'free_months'; percentOff: number | null; amountOffMinor: number | null; freeMonths: number | null;
  appliesTo: PlanCode[] | null; maxRedemptions: number | null; validFrom: string | null; validUntil: string | null; active: boolean; note: string | null;
};
export type AdminCoupon = AdminCouponFields & { id: string; redemptions: number; createdAt: string };

/** A14 — server/modules/admin/privacy.ts, retention.ts */
export type AdminPrivacyRequest = {
  id: string; type: 'export' | 'erase'; status: 'received' | 'processing' | 'completed' | 'rejected'; subjectEmail: string | null; subjectUserId: string | null;
  identityCheck: string | null; note: string | null; receivedAt: string; dueAt: string | null; completedAt: string | null; overdue: boolean; hasExport: boolean;
};
type Bi2 = { ar: string; en: string };
export type AdminRetention = {
  rules: { key: string; what: Bi2; keep: Bi2; due: number }[]; never: { what: Bi2; why: Bi2 }[]; deletedStoresForReview: number; asOf: string;
};

/** T69 — server/modules/admin/site.ts */
export type AdminSiteSettings = { ga4MeasurementId: string | null; updatedAt: string | null };

/** A13 — server/modules/admin/announcements.ts */
export type AdminAnnouncementFields = {
  titleAr: string; titleEn: string; bodyAr: string | null; bodyEn: string | null;
  level: 'info' | 'warning'; link: string | null; startsAt: string; endsAt: string; active: boolean;
};
export type AdminAnnouncement = AdminAnnouncementFields & { id: string; createdAt: string; live: boolean };
/** P3.10 — server/modules/admin/professional.ts */
export type AdminProfessionalRow = import('./contracts/professional').ProfessionalOrderView & {
  store: { id: string; name: string; nameAr: string | null };
  product: { dimensions: { widthMm?: number; heightMm?: number; depthMm?: number } | null; photos: number };
};
export type AdminProfessionalQueue = { rows: AdminProfessionalRow[]; counts: Record<import('./contracts/professional').ProfessionalStatus, number> };
/** P3.6 / A10 — server/modules/admin/qa.ts */
export type AdminQaStatus = 'pending' | 'approved' | 'rejected';
export type AdminQaRow = {
  modelId: string; name: string;
  store: { id: string; name: string; nameAr: string | null };
  product: { id: string; name: string; nameAr: string | null; sizeMm: { widthMm?: number; heightMm?: number; depthMm?: number } | null } | null;
  qaStatus: AdminQaStatus; qaNotes: string | null;
  version: { id: string; number: number; polyCount: number | null; sizeMm: [number, number, number] | null; webBytes: number | null; readyAt: string };
};
export type AdminQaQueue = { rows: AdminQaRow[]; counts: Record<AdminQaStatus, number> };
/** A9 — server/modules/admin/ai-ops.ts */
export type AdminAiJob = {
  id: string; type: string; status: string; store: { id: string; name: string; nameAr: string | null }; creditsCost: number; costCents: number; attempts: number;
  errorCode: string | null; errorMessage: string | null; queuedAt: string | null; startedAt: string | null; finishedAt: string | null; lastHeardAt: string | null;
};
export type AdminAiOperations = {
  days: number;
  totals: { jobs: number; costCents: number; gpuSeconds: number; creditsCharged: number; failureRate: number | null };
  byType: { type: string; total: number; done: number; failed: number; cancelled: number; open: number; medianSeconds: number | null; costCents: number; gpuSeconds: number; creditsCharged: number }[];
  failures: AdminAiJob[]; quiet: AdminAiJob[];
  topStores: { id: string; name: string; nameAr: string | null; jobs: number; costCents: number; creditsCharged: number }[];
  guardrails: AdminAiGuardrails & { spentTodayCents: number };
  asOf: string;
};

/** P6.7 — the brakes on AI spend; null caps mean no limit. */
export type AdminAiGuardrails = { pausedTypes: string[]; dailySpendCapCents: number | null; storeDailyJobsCap: number | null; updatedAt: string | null };

/** P6 — server/modules/admin/models.ts: a provider model, its A/B share, and how its jobs did. */
export type AdminAiModel = {
  id: string; name: string; version: string; provider: string; endpoint: string | null; jobType: string | null;
  active: boolean; split: number; costPerCallCents: number; rolledBackAt: string | null; createdAt: string;
  outcomes: { jobs: number; done: number; failed: number; successRate: number | null; medianSeconds: number | null; costCents: number } | null;
};
export type NewAdminAiModel = { name: string; version: string; provider: string; endpoint: string | null; jobType: string; costPerCallCents: number; reason: string };

export type AdminApi = {
  whoami(): Promise<{ email: string; fullName: string }>;
  trail(storeId?: string): Promise<StaffTrailRow[]>;
  overview(): Promise<PlatformOverview>;
  stores(query: { q?: string; status?: string; plan?: string; before?: string }): Promise<{ stores: AdminStoreRow[]; next: string | null }>;
  store(id: string): Promise<AdminStoreDetail>;
  act(id: string, action: AdminStoreAction): Promise<void>;
  people(query: { q?: string; before?: string }): Promise<{ people: AdminPersonRow[]; next: string | null }>;
  person(id: string): Promise<AdminPersonDetail>;
  actOnPerson(id: string, action: AdminPersonAction): Promise<{ sessionsEnded: number }>;
  plans(): Promise<AdminPlan[]>;
  updatePlan(code: PlanCode, change: AdminPlanChange): Promise<{ changed: string[] }>;
  subscriptions(query: { status?: string; plan?: string; cycle?: string; before?: string }): Promise<{ subscriptions: AdminSubscriptionRow[]; next: string | null; byStatus: Partial<Record<AdminSubscriptionRow['status'], number>> }>;
  invoices(query: { status?: string; month?: string; q?: string; before?: string }): Promise<{ invoices: AdminInvoiceRow[]; next: string | null; totals: { count: number; totalMinor: number; vatMinor: number } }>;
  invoice(id: string): Promise<{ store: AdminStoreRef; invoice: InvoiceDocument }>;
  operations(): Promise<AdminOperations>;
  retryJob(id: string, reason: string): Promise<void>;
  replayWebhook(id: string, reason: string): Promise<void>;
  lookup(q: string): Promise<AdminLookup>;
  storeActivity(id: string, before?: string): Promise<{ entries: AdminTrailEntry[]; next: string | null }>;
  coupons(): Promise<AdminCoupon[]>;
  createCoupon(fields: AdminCouponFields & { reason: string }): Promise<AdminCoupon>;
  updateCoupon(id: string, patch: Partial<AdminCouponFields> & { reason: string }): Promise<AdminCoupon>;
  /** A4b: point this session at the store, read-only, then re-read `me`. */
  viewStore(id: string, minutes: number, reason: string): Promise<void>;
  endView(): Promise<void>;
  privacyRequests(): Promise<{ requests: AdminPrivacyRequest[]; responseDays: number }>;
  recordPrivacy(input: { type: 'export' | 'erase'; subjectEmail: string; identityCheck: string }): Promise<AdminPrivacyRequest>;
  fulfilExport(id: string): Promise<void>;
  privacyExport(id: string): Promise<unknown>;
  fulfilErasure(id: string): Promise<void>;
  rejectPrivacy(id: string, reason: string): Promise<void>;
  retention(): Promise<AdminRetention>;
  announcements(): Promise<AdminAnnouncement[]>;
  /** T69 — the website's own settings: its GA4 measurement id. */
  site(): Promise<AdminSiteSettings>;
  updateSite(input: { ga4MeasurementId: string | null; reason: string }): Promise<AdminSiteSettings>;
  ga4Picker: Ga4Picker;
  createAnnouncement(fields: AdminAnnouncementFields & { reason: string }): Promise<AdminAnnouncement>;
  updateAnnouncement(id: string, patch: Partial<AdminAnnouncementFields> & { reason: string }): Promise<AdminAnnouncement>;
  qaQueue(status: AdminQaStatus): Promise<AdminQaQueue>;
  professionalQueue(status: import('./contracts/professional').ProfessionalStatus): Promise<AdminProfessionalQueue>;
  quoteProfessional(orderId: string, input: { priceMinor: number; note: string | null }): Promise<void>;
  markProfessionalPaid(orderId: string, reference: string): Promise<void>;
  deliverProfessional(orderId: string, file: File): Promise<void>;
  decideQa(modelId: string, input: { decision: 'approved' | 'rejected'; versionId: string; notes?: string }): Promise<void>;
  /** The version's web GLB, for the reviewer's viewer (a Blob: the viewer's own fetch has no session). */
  qaModel(versionId: string): Promise<Blob>;
  aiOperations(days: 7 | 30 | 90): Promise<AdminAiOperations>;
  cancelAiJob(id: string, reason: string): Promise<void>;
  setAiGuardrails(input: Omit<AdminAiGuardrails, 'updatedAt'> & { reason: string }): Promise<AdminAiGuardrails>;
  aiModels(days: 7 | 30 | 90): Promise<AdminAiModel[]>;
  registerAiModel(input: NewAdminAiModel): Promise<AdminAiModel>;
  setAiSplits(input: { jobType: string; splits: { id: string; percent: number }[]; reason: string }): Promise<AdminAiModel[]>;
  setAiModelActive(id: string, active: boolean, reason: string): Promise<AdminAiModel[]>;
  rollbackAiModel(id: string, reason: string): Promise<AdminAiModel[]>;
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
    startSso: async (store) => (await client.startSso(store)).authorizeUrl,
    completeSso: async (code, state) => { await client.completeSso(code, state); await load(); },
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
      people: (query) => {
        const params = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => !!e[1]));
        return client.call(`/api/admin/users${params.size ? `?${params}` : ''}`);
      },
      person: (id) => client.call(`/api/admin/users/${encodeURIComponent(id)}`),
      actOnPerson: (id, action) => client.call(`/api/admin/users/${encodeURIComponent(id)}/actions`, { body: action }),
      plans: async () => (await client.call<{ plans: AdminPlan[] }>('/api/admin/plans')).plans,
      updatePlan: (code, change) => client.call(`/api/admin/plans/${code}`, { method: 'PATCH', body: change }),
      subscriptions: (query) => client.call(`/api/admin/subscriptions${queryString(query)}`),
      invoices: (query) => client.call(`/api/admin/invoices${queryString(query)}`),
      invoice: (id) => client.call(`/api/admin/invoices/${encodeURIComponent(id)}`),
      operations: () => client.call('/api/admin/operations'),
      retryJob: async (id, reason) => { await client.call(`/api/admin/jobs/${encodeURIComponent(id)}/retry`, { body: { reason } }); },
      replayWebhook: async (id, reason) => { await client.call(`/api/admin/webhooks/${encodeURIComponent(id)}/replay`, { body: { reason } }); },
      lookup: (q) => client.call(`/api/admin/support${queryString({ q })}`),
      storeActivity: (id, before) => client.call(`/api/admin/stores/${encodeURIComponent(id)}/activity${queryString({ before })}`),
      coupons: async () => (await client.call<{ coupons: AdminCoupon[] }>('/api/admin/coupons')).coupons,
      createCoupon: (fields) => client.call('/api/admin/coupons', { body: fields }),
      updateCoupon: (id, patch) => client.call(`/api/admin/coupons/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
      viewStore: async (id, minutes, reason) => { await client.call(`/api/admin/stores/${encodeURIComponent(id)}/view`, { body: { minutes, reason } }); await load(); },
      endView: async () => { await client.call('/api/admin/view/end', { method: 'POST' }); await load(); },
      privacyRequests: () => client.call('/api/admin/privacy'),
      recordPrivacy: (input) => client.call('/api/admin/privacy', { body: input }),
      fulfilExport: async (id) => { await client.call(`/api/admin/privacy/${encodeURIComponent(id)}/export`, { method: 'POST' }); },
      privacyExport: (id) => client.call(`/api/admin/privacy/${encodeURIComponent(id)}/export`),
      fulfilErasure: async (id) => { await client.call(`/api/admin/privacy/${encodeURIComponent(id)}/erase`, { method: 'POST' }); },
      rejectPrivacy: async (id, reason) => { await client.call(`/api/admin/privacy/${encodeURIComponent(id)}/reject`, { body: { reason } }); },
      retention: () => client.call('/api/admin/retention'),
      announcements: async () => (await client.call<{ announcements: AdminAnnouncement[] }>('/api/admin/announcements')).announcements,
      site: () => client.call('/api/admin/site'),
      updateSite: (input) => client.call('/api/admin/site', { method: 'PUT', body: input }),
      ga4Picker: ga4PickerFor(client, 'site'),
      createAnnouncement: (fields) => client.call('/api/admin/announcements', { body: fields }),
      updateAnnouncement: (id, patch) => client.call(`/api/admin/announcements/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
      qaQueue: (status) => client.call(`/api/admin/qa?status=${status}`),
      professionalQueue: (status) => client.call(`/api/admin/professional?status=${status}`),
      quoteProfessional: async (orderId, input) => { await client.call(`/api/admin/professional/${encodeURIComponent(orderId)}/quote`, { body: input }); },
      markProfessionalPaid: async (orderId, reference) => { await client.call(`/api/admin/professional/${encodeURIComponent(orderId)}/paid`, { body: { reference } }); },
      deliverProfessional: async (orderId, file) => {
        const base = `/api/admin/professional/${encodeURIComponent(orderId)}/delivery`;
        const started = await client.call<{ versionId: string; uploadUrl: string; contentType: string }>(base, { body: { filename: file.name, sizeBytes: file.size } });
        const put = await fetch(started.uploadUrl, { method: 'PUT', headers: { 'content-type': started.contentType }, body: file });
        if (!put.ok) throw new Error('the file did not reach storage — try again');
        await client.call(`${base}/confirm`, { body: { versionId: started.versionId } });
      },
      decideQa: async (modelId, input) => { await client.call(`/api/admin/qa/${encodeURIComponent(modelId)}`, { body: input }); },
      qaModel: (versionId) => client.callBlob(`/api/admin/qa/versions/${encodeURIComponent(versionId)}/model`),
      aiOperations: (days) => client.call(`/api/admin/ai?days=${days}`),
      cancelAiJob: async (id, reason) => { await client.call(`/api/admin/ai/jobs/${encodeURIComponent(id)}/cancel`, { body: { reason } }); },
      setAiGuardrails: (input) => client.call('/api/admin/ai/guardrails', { method: 'PUT', body: input }),
      aiModels: async (days) => (await client.call<{ models: AdminAiModel[] }>(`/api/admin/ai/models?days=${days}`)).models,
      registerAiModel: (input) => client.call('/api/admin/ai/models', { body: input }),
      setAiSplits: async (input) => (await client.call<{ models: AdminAiModel[] }>('/api/admin/ai/models/splits', { method: 'PUT', body: input })).models,
      setAiModelActive: async (id, active, reason) => (await client.call<{ models: AdminAiModel[] }>(`/api/admin/ai/models/${encodeURIComponent(id)}/active`, { body: { active, reason } })).models,
      rollbackAiModel: async (id, reason) => (await client.call<{ models: AdminAiModel[] }>(`/api/admin/ai/models/${encodeURIComponent(id)}/rollback`, { body: { reason } })).models,
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
    addStore: async (storeName) => { await client.addStore(storeName); await load(); },
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
const demoAdmin: AdminApi = { whoami: notFound, trail: notFound, overview: notFound, stores: notFound, store: notFound, act: notFound, people: notFound, person: notFound, actOnPerson: notFound, plans: notFound, updatePlan: notFound, subscriptions: notFound, invoices: notFound, invoice: notFound, operations: notFound, retryJob: notFound, replayWebhook: notFound, lookup: notFound, storeActivity: notFound, coupons: notFound, createCoupon: notFound, updateCoupon: notFound, viewStore: notFound, endView: notFound, privacyRequests: notFound, recordPrivacy: notFound, fulfilExport: notFound, privacyExport: notFound, fulfilErasure: notFound, rejectPrivacy: notFound, retention: notFound, announcements: notFound, site: notFound, updateSite: notFound, ga4Picker: noGa4Picker, createAnnouncement: notFound, updateAnnouncement: notFound, qaQueue: notFound, professionalQueue: notFound, quoteProfessional: notFound, markProfessionalPaid: notFound, deliverProfessional: notFound, decideQa: notFound, qaModel: notFound, aiOperations: notFound, cancelAiJob: notFound, setAiGuardrails: notFound, aiModels: notFound, registerAiModel: notFound, setAiSplits: notFound, setAiModelActive: notFound, rollbackAiModel: notFound };

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
    startSso: async () => { throw new Error('preview'); },
    completeSso: async () => { throw new Error('preview'); },
    completeTwoFactor: async () => {},
    twoFactor: demoTwoFactor,
    // The preview has no staff: the console answers as it does for any merchant.
    admin: demoAdmin,
    register: async () => ({ slugNeedsConfirmation: false }),
    logout: async () => {},
    switchTenant: async () => {},
    addStore: async () => { throw new ApiError(409, 'conflict', 'the preview has one store — adding stores works in the live dashboard'); },
    acceptInvitation: async () => {},
    requestPasswordReset: async () => {},
    resetPassword: async () => {},
    verifyEmail: async () => {},
    resendVerification: async () => ({ sent: false, alreadyVerified: true }),
  }), [tenant]);
  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}
