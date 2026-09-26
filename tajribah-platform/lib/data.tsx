'use client';

/**
 * Where a screen gets its data.
 *
 * One interface, two implementations: the demo source (seeded, for the static preview) and
 * the API source (P1, once the endpoints exist). Screens call the hooks and never know
 * which one answered — so the preview exercises the real components, and swapping in the
 * API changes no screen code.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  DEMO_ANALYTICS, DEMO_BILLING, DEMO_CONNECTION, DEMO_DASHBOARD, DEMO_MODELS, DEMO_NOTIFICATIONS, DEMO_PRODUCTS, DEMO_SYNC, DEMO_TEAM, DEMO_WEBHOOKS,
} from './demo-data';
import type {
  AnalyticsView, BillingSummary, ConnectionDetail, DashboardSummary, InstallCheck, ModelRow, ModelVersionRow, NotificationItem, ProductRow, SyncProgress, TeamMemberRow, TenantSummary,
} from './view-models';
import { ApiError, currentStore, type ApiClient } from './api-client';
import type { Lang } from './lang';
import type { ProductListPage, ProductListQuery } from './contracts/products';
import type { PlanCode } from './plans';
import { DEFAULT_BUTTON_RADIUS, SettingsPatch, type StoreSettings } from './contracts/settings';
import { ArConfigInput, DEFAULT_AR_CONFIG, placementErrors, placementsFor, type ArConfigView } from './contracts/ar-config';
import { pageOf } from './product-list';
import { MODEL_TARGET_BYTES } from './model-size';
import { embedSnippet } from '../widget/src/snippet';
import { applyEdit, editErrors, type ProductEdit } from './product-edit';
import { STEP_COPY } from './onboarding-steps';
import { priceInvoiceLines, type InvoiceDocument } from './contracts/invoices';
import { SELLER } from '@/server/core/billing/seller';
import { slugProblem } from './slug';
import type { OnboardingState } from '@/db/schema';
import {
  OnboardingError, confirmStore as confirmStoreRule, evaluate, skip as skipRule, unskip as unskipRule,
  type Facts, type OnboardingView, type StepKey,
} from '@/server/modules/onboarding/machine';

export interface DataSource {
  /** The store being viewed. The shell reads it on every screen for the store switcher. */
  currentTenant(): Promise<TenantSummary>;
  dashboard(): Promise<DashboardSummary>;
  /** One page of the catalogue: search, filter and cursor are the server's (P1.9). */
  products(query?: Partial<ProductListQuery>): Promise<ProductListPage>;
  product(id: string): Promise<ProductRow | null>;
  /** P1.10. Refusals arrive as `ApiError` 422 with per-field messages. */
  updateProduct(id: string, edit: ProductEdit): Promise<ProductRow>;
  /** P1.11: every store connection with its latest sync and webhook health. */
  connections(): Promise<ConnectionDetail[]>;
  syncNow(connectionId: string): Promise<SyncProgress>;
  disconnect(connectionId: string): Promise<void>;
  models(): Promise<ModelRow[]>;
  /** P1.14. Newest first; `isCurrent` marks the live one. */
  modelVersions(modelId: string): Promise<ModelVersionRow[]>;
  publishVersion(versionId: string): Promise<void>;
  /** P1.12 uploader: presigned PUT straight to storage, then the server checks the bytes. */
  uploadModel(file: File, target?: { productId?: string; modelId?: string }): Promise<{ modelId: string; status: 'processing' | 'failed'; error: string | null }>;
  team(): Promise<TeamMemberRow[]>;
  /** P1.24. The link goes by email only; nothing here ever sees the token. */
  invite(email: string, role: TeamMemberRow['role'], lang: Lang): Promise<void>;
  revokeInvitation(invitationId: string): Promise<void>;
  changeRole(membershipId: string, role: TeamMemberRow['role']): Promise<void>;
  removeMember(membershipId: string): Promise<void>;
  billing(): Promise<BillingSummary>;
  /** P1.25. Refusals: `ApiError` 422 with per-field messages. */
  settings(): Promise<StoreSettings>;
  /** P1.17: the snippet to paste, and a live check of a product page. */
  embed(): Promise<{ storeKey: string; snippet: string; storeHost: string | null }>;
  checkInstall(url: string): Promise<InstallCheck>;
  /** P1.23: the signed-in person's own notifications, newest first. */
  notifications(): Promise<{ items: NotificationItem[]; unread: number }>;
  markNotificationsRead(ids: string[] | 'all'): Promise<void>;
  /** P1.21: AR button and viewer settings per product. */
  arConfigs(): Promise<ArConfigView[]>;
  saveArConfig(productId: string, input: ArConfigInput): Promise<ArConfigView>;
  updateSettings(patch: Record<string, unknown>): Promise<StoreSettings>;
  analytics(range: '7d' | '30d' | '90d'): Promise<AnalyticsView>;
  /** P1.2: the setup checklist as the database decides it (P1.1), and the merchant's moves on it. */
  onboarding(): Promise<OnboardingView>;
  skipStep(step: StepKey): Promise<OnboardingView>;
  unskipStep(step: StepKey): Promise<OnboardingView>;
  /** `slug` chooses the store's address; refused once the store is confirmed. */
  confirmStore(slug?: string): Promise<OnboardingView>;
  /** P2.6: one invoice exactly as issued, or null (not this store's, or no such invoice). */
  invoice(id: string): Promise<InvoiceDocument | null>;
  /** P2.12: may this store use the code for this plan and cycle — the server decides. Refusals: 422 on `code`. */
  checkCoupon(code: string, plan: PlanCode, cycle: 'monthly' | 'annual'): Promise<CouponQuote>;
}

export type CouponQuote = { code: string; kind: 'percent' | 'fixed' | 'free_months'; discountMinor: number; freeMonths: number; description: { ar: string; en: string } };

/**
 * The real API. The store summary (`/api/auth/me`) and the catalogue (`/api/products`, P1.8)
 * exist server-side; models, team, billing and analytics arrive with later packages. Until
 * then those screens show their error state with this message — not demo numbers passed
 * off as the merchant's own.
 */
export function apiSource(client: ApiClient): DataSource {
  const pending = (what: string) => () => Promise.reject(new ApiError(501, 'not_implemented',
    `${what} is not available yet — its API arrives with the core-loop phase (P1).`));
  return {
    async currentTenant() {
      const store = currentStore(await client.me());
      if (!store) throw new ApiError(404, 'not_found', 'no store on this account');
      return store;
    },
    async dashboard() { return client.call<DashboardSummary>('/api/dashboard'); },
    async products(query = {}) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
      }
      const qs = params.toString();
      return client.call<ProductListPage>(`/api/products${qs ? `?${qs}` : ''}`);
    },
    async product(id) {
      try {
        return await client.call<ProductRow>(`/api/products/${encodeURIComponent(id)}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    async updateProduct(id, edit) {
      return client.call<ProductRow>(`/api/products/${encodeURIComponent(id)}`, { method: 'PATCH', body: edit });
    },
    async connections() {
      return (await client.call<{ connections: ConnectionDetail[] }>('/api/connections')).connections;
    },
    async syncNow(connectionId) {
      return client.call<SyncProgress>(`/api/connections/${encodeURIComponent(connectionId)}/sync`, { method: 'POST' });
    },
    async disconnect(connectionId) {
      await client.call<void>(`/api/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
    },
    async models() {
      return (await client.call<{ models: ModelRow[] }>('/api/models')).models;
    },
    async modelVersions(modelId) {
      return (await client.call<{ versions: ModelVersionRow[] }>(`/api/models/${encodeURIComponent(modelId)}/versions`)).versions;
    },
    async publishVersion(versionId) {
      await client.call<void>(`/api/models/versions/${encodeURIComponent(versionId)}/publish`, { method: 'POST' });
    },
    async uploadModel(file, target = {}) {
      const started = await client.call<{ modelId: string; versionId: string; uploadUrl: string; contentType: string }>(
        '/api/models/uploads', { method: 'POST', body: { filename: file.name, sizeBytes: file.size, ...target } });
      // Straight to storage: no session header — the signature in the URL is the permission.
      const put = await fetch(started.uploadUrl, { method: 'PUT', headers: { 'content-type': started.contentType }, body: file });
      if (!put.ok) throw new ApiError(put.status, 'upload_failed', 'the file did not reach storage — try again');
      const confirmed = await client.call<{ status: 'processing' | 'failed'; error: string | null }>(
        `/api/models/versions/${encodeURIComponent(started.versionId)}/confirm`, { method: 'POST' });
      return { modelId: started.modelId, ...confirmed };
    },
    async team() {
      return (await client.call<{ members: TeamMemberRow[] }>('/api/team')).members;
    },
    async invite(email, role, lang) {
      await client.call('/api/team/invitations', { method: 'POST', body: { email, role, lang } });
    },
    async revokeInvitation(id) {
      await client.call<void>(`/api/team/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async changeRole(id, role) {
      await client.call<void>(`/api/team/members/${encodeURIComponent(id)}`, { method: 'PATCH', body: { role } });
    },
    async removeMember(id) {
      await client.call<void>(`/api/team/members/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async billing() { return client.call<BillingSummary>('/api/billing'); },
    async settings() { return client.call<StoreSettings>('/api/settings'); },
    async arConfigs() { return (await client.call<{ configs: ArConfigView[] }>('/api/ar-configs')).configs; },
    async notifications() { return client.call<{ items: NotificationItem[]; unread: number }>('/api/notifications'); },
    async embed() { return client.call<{ storeKey: string; snippet: string; storeHost: string | null }>('/api/embed'); },
    async checkInstall(url) { return client.call<InstallCheck>('/api/embed/check', { method: 'POST', body: { url } }); },
    async markNotificationsRead(ids) {
      await client.call('/api/notifications/read', { method: 'POST', body: ids === 'all' ? { all: true } : { ids } });
    },
    async saveArConfig(productId, input) {
      return client.call<ArConfigView>(`/api/ar-configs/${encodeURIComponent(productId)}`, { method: 'PUT', body: input });
    },
    async updateSettings(patch) { return client.call<StoreSettings>('/api/settings', { method: 'PATCH', body: patch }); },
    analytics: pending('Analytics'),
    async onboarding() { return client.call<OnboardingView>('/api/onboarding'); },
    async skipStep(step) { return client.call<OnboardingView>('/api/onboarding/skip', { body: { step } }); },
    async unskipStep(step) { return client.call<OnboardingView>('/api/onboarding/unskip', { body: { step } }); },
    async confirmStore(slug) {
      return client.call<OnboardingView>('/api/onboarding/confirm-store', slug === undefined ? { method: 'POST' } : { body: { slug } });
    },
    async checkCoupon(code, plan, cycle) {
      return client.call<CouponQuote>('/api/billing/coupons/check', { body: { code, plan, cycle } });
    },
    async invoice(id) {
      try {
        return await client.call<InvoiceDocument>(`/api/billing/invoices/${encodeURIComponent(id)}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  };
}

/**
 * The preview's one invoice, at `/dashboard/billing/invoices/sample` only — the demo store is on
 * its trial, so its invoice list stays empty rather than invent history. The screen marks it a
 * sample. Seller details are the real ones (`SELLER`); the VAT number is empty until supplied.
 */
function sampleInvoice(): InvoiceDocument {
  const priced = priceInvoiceLines([
    { description: 'Growth plan — monthly subscription', descriptionAr: 'باقة النمو — اشتراك شهري', quantity: 1, unitPriceMinor: 29_900 },
    { description: 'AI credits pack (20)', descriptionAr: 'باقة أرصدة ذكاء اصطناعي (20)', quantity: 1, unitPriceMinor: 9_900 },
  ]);
  return {
    ...priced, id: 'sample', number: 'TJ-2026-SAMPLE00-000001', status: 'paid', kind: 'simplified', currency: 'SAR',
    issuedAt: '2026-10-05T09:00:00.000Z', dueAt: '2026-10-05T09:00:00.000Z', paidAt: '2026-10-05T09:00:00.000Z',
    seller: { name: SELLER.nameEn, nameAr: SELLER.nameAr, crNumber: SELLER.crNumber, vatNumber: SELLER.vatNumber, address: SELLER.nationalAddress },
    buyer: { name: 'Failet', nameAr: 'فايلت', crNumber: null, vatNumber: null, address: null },
    zatca: { status: null, qr: null },
  };
}

/** Seeded data, resolved on a microtask so screens exercise their loading states. */
/** The preview's edits, for this page load only: the preview has nowhere to save them. */
const demoEdits = new Map<string, ProductRow>();
const demoTeam: TeamMemberRow[] = DEMO_TEAM.map((m) => ({ ...m }));
const demoArConfigs = new Map<string, ArConfigView>();
const demoNotifications: NotificationItem[] = DEMO_NOTIFICATIONS.map((n) => ({ ...n }));
function demoArDefault(p: ProductRow): ArConfigView {
  return {
    productId: p.id, productName: p.name, productNameAr: p.nameAr, productType: p.productType, arEnabled: p.arEnabled,
    buttonLabelAr: DEFAULT_AR_CONFIG.buttonLabelAr, buttonLabelEn: DEFAULT_AR_CONFIG.buttonLabelEn, variant: DEFAULT_AR_CONFIG.variant,
    showIcon: DEFAULT_AR_CONFIG.showIcon, placement: placementsFor(p.productType)[0], scale: 1, autoRotate: true, shadow: 1,
    saved: false, publishedVersion: 0, unpublishedChanges: false,
  };
}
/** The preview store's settings: blank identity fields, as a new merchant has (§11). */
const demoSettings: StoreSettings = {
  slug: DEMO_DASHBOARD.tenant.slug, name: DEMO_DASHBOARD.tenant.name, nameAr: null, crNumber: null, vatNumber: null,
  nationalAddress: null, city: null, brandColor: null, buttonRadius: DEFAULT_BUTTON_RADIUS, consentTextAr: null, consentTextEn: null,
};
const demoModels: ModelRow[] = DEMO_MODELS.map((m) => ({ ...m }));
/** Which version is live per demo model, when it is not the newest. */
const demoLive = new Map<string, number>();
/** Versions 1…n of a demo model; older ready versions stand in for rollbacks. */
function demoVersionsOf(model: ModelRow): ModelVersionRow[] {
  const live = demoLive.get(model.id) ?? (model.status === 'ready' ? model.version : 0);
  return Array.from({ length: Math.max(model.version, 1) }, (_, i) => model.version - i).map((n) => {
    const newest = n === model.version;
    const status = newest ? model.status : 'ready';
    const bytes = newest ? model.sizeBytes : Math.round(model.sizeBytes * (1.25 + (model.version - n) * 0.2));
    return {
      id: `${model.id}@${n}`, version: n, status, isCurrent: n === live,
      polyCount: model.polyCount, originalBytes: bytes ? Math.round(bytes * 3.4) : null,
      optimizedBytes: status === 'ready' && bytes ? bytes : null,
      withinTarget: status === 'ready' && bytes ? bytes <= MODEL_TARGET_BYTES : null,
      error: status === 'failed' ? 'the GLB could not be read: no scene in the file' : null,
      createdAt: model.updatedAt,
    };
  });
}
const demoConnectionState: { status: ConnectionDetail['status']; lastSyncAt: string | null; sync: SyncProgress | null } =
  { status: DEMO_CONNECTION.status, lastSyncAt: DEMO_CONNECTION.lastSyncAt, sync: null };
function demoConnections(): ConnectionDetail[] {
  return [{
    ...DEMO_CONNECTION, status: demoConnectionState.status, lastSyncAt: demoConnectionState.lastSyncAt,
    latestSync: demoConnectionState.sync ?? DEMO_SYNC, webhooks: DEMO_WEBHOOKS,
  }];
}

/**
 * The preview's setup state. The facts come from the demo catalogue, so a dimension added or
 * a model published in the preview moves the checklist exactly as the database would; the
 * rules are the server's own (server/modules/onboarding/machine.ts). The demo store starts
 * unconfirmed and on the trial, so every step of the guide can be tried.
 */
let demoOnboardingState: OnboardingState = { step: 'store', completedSteps: ['account'], skipped: [] };
const demoTenant = { ...DEMO_DASHBOARD.tenant };
function demoFacts(): Facts {
  const products = DEMO_PRODUCTS.map((p) => demoEdits.get(p.id) ?? p);
  return {
    storeConfirmed: demoOnboardingState.completedSteps.includes('store'),
    hasPlan: false,
    hasActiveConnection: demoConnectionState.status === 'active',
    hasSizedProduct: products.some((p) => p.status === 'active' && p.dimensions?.widthMm != null && p.dimensions?.heightMm != null),
    hasReadyModel: demoModels.some((m) => m.status === 'ready'),
    widgetSeen: false,
  };
}
function demoOnboardingChange(apply: (s: OnboardingState, f: Facts) => OnboardingState): OnboardingView {
  const facts = demoFacts();
  try {
    demoOnboardingState = apply(demoOnboardingState, facts);
  } catch (error) {
    if (error instanceof OnboardingError) throw new ApiError(422, 'validation_failed', 'Validation failed', { step: [error.message] });
    throw error;
  }
  return evaluate(demoFacts(), demoOnboardingState); // facts re-read: the demo's come from the state
}

export const demoSource: DataSource = {
  async currentTenant() { return { ...demoTenant }; },
  async dashboard() {
    const view = evaluate(demoFacts(), demoOnboardingState);
    const steps = STEP_COPY.map((copy) => {
      const step = view.steps.find((s) => s.key === copy.key);
      return { ...copy, done: step?.done ?? false, skipped: step?.skipped ?? false };
    });
    return { ...DEMO_DASHBOARD, tenant: { ...demoTenant }, onboarding: { complete: view.complete, steps } };
  },
  async products(query = {}) { return pageOf(DEMO_PRODUCTS.map((p) => demoEdits.get(p.id) ?? p), query); },
  async product(id) { return demoEdits.get(id) ?? DEMO_PRODUCTS.find((p) => p.id === id) ?? null; },
  async updateProduct(id, edit) {
    const current = demoEdits.get(id) ?? DEMO_PRODUCTS.find((p) => p.id === id);
    if (!current) throw new ApiError(404, 'not_found', 'product not found');
    const fields = editErrors(current, edit);
    if (Object.keys(fields).length) throw new ApiError(422, 'validation_failed', 'Validation failed', fields);
    const next = applyEdit(current, edit);
    demoEdits.set(id, next);
    return next;
  },
  async connections() { return demoConnections(); },
  async syncNow(connectionId) {
    const connection = demoConnections().find((c) => c.id === connectionId);
    if (!connection) throw new ApiError(404, 'not_found', 'store connection not found');
    if (connection.status !== 'active') throw new ApiError(409, 'conflict', `the store connection is ${connection.status} — reconnect the store`);
    // The preview has no worker: the sync it starts finishes at once, with the catalogue it has.
    const now = new Date().toISOString();
    demoConnectionState.sync = {
      id: `sync-${Date.now()}`, connectionId, type: 'incremental', status: 'done', triggeredBy: 'user',
      processed: DEMO_PRODUCTS.length, failed: 0, total: DEMO_PRODUCTS.length, percent: 100,
      startedAt: now, finishedAt: now, error: null,
    };
    demoConnectionState.lastSyncAt = now;
    return demoConnectionState.sync;
  },
  async disconnect(connectionId) {
    if (!demoConnections().some((c) => c.id === connectionId)) throw new ApiError(404, 'not_found', 'store connection not found');
    demoConnectionState.status = 'revoked';
  },
  async models() { return demoModels.map((m) => ({ ...m })); },
  async modelVersions(modelId) {
    const model = demoModels.find((m) => m.id === modelId);
    if (!model) throw new ApiError(404, 'not_found', 'model not found');
    return demoVersionsOf(model);
  },
  async publishVersion(versionId) {
    const [modelId, n] = versionId.split('@');
    const model = demoModels.find((m) => m.id === modelId);
    const version = model && demoVersionsOf(model).find((v) => v.id === versionId);
    if (!model || !version) throw new ApiError(404, 'not_found', 'model version not found');
    if (version.status !== 'ready') throw new ApiError(409, 'conflict', `version ${n} is ${version.status} — only a ready version can go live`);
    demoLive.set(model.id, Number(n));
  },
  async uploadModel(file) {
    // The preview has no storage and no worker: the upload is accepted and stays processing.
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'glb' && ext !== 'usdz') throw new ApiError(422, 'validation_failed', 'Validation failed', { filename: ['only .glb and .usdz files can be uploaded'] });
    const model: ModelRow = {
      id: `m-upload-${demoModels.length + 1}`, productId: null, productName: null, name: file.name.replace(/\.[^.]+$/, ''),
      source: 'uploaded', status: 'processing', qaStatus: 'pending', version: 1, sizeBytes: 0, polyCount: null,
      formats: [], thumbnailUrl: null, updatedAt: new Date().toISOString(),
    };
    demoModels.unshift(model);
    return { modelId: model.id, status: 'processing', error: null };
  },
  async team() { return demoTeam.map((m) => ({ ...m })); },
  async invite(email, role) {
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new ApiError(422, 'validation_failed', 'Validation failed', { email: ['is not an email address'] });
    if (role === 'owner') throw new ApiError(422, 'validation_failed', 'Validation failed', { role: ['cannot be given by invitation'] });
    if (demoTeam.some((m) => m.email === address && m.status !== 'invited')) throw new ApiError(409, 'conflict', 'this person is already on the team');
    const open = demoTeam.find((m) => m.email === address);
    if (open) open.role = role;
    else demoTeam.push({ id: `inv-${demoTeam.length + 1}`, fullName: '', email: address, role, status: 'invited', lastLoginAt: null });
  },
  async revokeInvitation(id) {
    const at = demoTeam.findIndex((m) => m.id === id && m.status === 'invited');
    if (at < 0) throw new ApiError(404, 'not_found', 'invitation not found');
    demoTeam.splice(at, 1);
  },
  async changeRole(id, role) {
    const member = demoTeam.find((m) => m.id === id && m.status !== 'invited');
    if (!member) throw new ApiError(404, 'not_found', 'team member not found');
    if (member.role === 'owner' || role === 'owner') throw new ApiError(403, 'forbidden', 'the owner’s role cannot be changed here');
    member.role = role;
  },
  async removeMember(id) {
    const at = demoTeam.findIndex((m) => m.id === id && m.status !== 'invited');
    if (at < 0) throw new ApiError(404, 'not_found', 'team member not found');
    if (demoTeam[at].role === 'owner') throw new ApiError(403, 'forbidden', 'the owner cannot be removed');
    demoTeam.splice(at, 1);
  },
  async billing() { return DEMO_BILLING; },
  async settings() { return { ...demoSettings }; },
  async embed() {
    return { storeKey: DEMO_DASHBOARD.tenant.slug, snippet: embedSnippet(DEMO_DASHBOARD.tenant.slug), storeHost: null };
  },
  async checkInstall(url) {
    // The preview has no server to fetch the page from: it says so instead of pretending.
    return { status: 'unreachable', detail: 'preview — the real app fetches the page and checks it', url };
  },
  async notifications() {
    return { items: demoNotifications.map((n) => ({ ...n })), unread: demoNotifications.filter((n) => !n.read).length };
  },
  async markNotificationsRead(ids) {
    for (const n of demoNotifications) if (ids === 'all' || ids.includes(n.id)) n.read = true;
  },
  async arConfigs() {
    return DEMO_PRODUCTS.filter((p) => p.status !== 'archived').map((p) => demoArConfigs.get(p.id) ?? demoArDefault(p));
  },
  async saveArConfig(productId, input) {
    const product = DEMO_PRODUCTS.find((p) => p.id === productId);
    if (!product) throw new ApiError(404, 'not_found', 'product not found');
    const parsed = ArConfigInput.safeParse(input);
    const fields: Record<string, string[]> = parsed.success ? placementErrors(product.productType, parsed.data.placement) : {};
    if (!parsed.success) for (const issue of parsed.error.issues) (fields[String(issue.path[0] ?? '_')] ??= []).push(issue.message);
    if (Object.keys(fields).length) throw new ApiError(422, 'validation_failed', 'Validation failed', fields);
    const view = { ...demoArDefault(product), ...parsed.data!, saved: true, unpublishedChanges: true };
    demoArConfigs.set(productId, view);
    return view;
  },
  async updateSettings(patch) {
    const parsed = SettingsPatch.safeParse(patch);
    if (!parsed.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) (fields[String(issue.path[0] ?? '_')] ??= []).push(issue.message);
      throw new ApiError(422, 'validation_failed', 'Validation failed', fields);
    }
    const { brandColor, buttonRadius, ...rest } = parsed.data;
    Object.assign(demoSettings, rest, brandColor !== undefined ? { brandColor } : {}, buttonRadius !== undefined ? { buttonRadius } : {});
    return { ...demoSettings };
  },
  async analytics(range) {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const series = DEMO_ANALYTICS.series.slice(-Math.min(days, DEMO_ANALYTICS.series.length));
    return { ...DEMO_ANALYTICS, range, series };
  },
  async onboarding() { return evaluate(demoFacts(), demoOnboardingState); },
  async invoice(id) { return id === 'sample' ? sampleInvoice() : null; },
  // The preview has no coupons: every code gets the server's answer for an unknown one.
  async checkCoupon() { throw new ApiError(422, 'validation_failed', 'Validation failed', { code: ['this code is not valid'] }); },
  async skipStep(step) { return demoOnboardingChange((s, f) => skipRule(s, step, f)); },
  async unskipStep(step) { return demoOnboardingChange((s, f) => unskipRule(s, step, f)); },
  async confirmStore(slug) {
    if (slug !== undefined && slug !== demoTenant.slug) {
      const problem = slugProblem(slug);
      if (problem) throw new ApiError(422, 'validation_failed', 'Validation failed', { slug: [problem] });
      if (demoFacts().storeConfirmed) throw new ApiError(422, 'validation_failed', 'Validation failed', { slug: ['the store address is fixed once the store is confirmed'] });
      demoTenant.slug = slug;
      demoSettings.slug = slug;
    }
    return demoOnboardingChange((s, f) => confirmStoreRule(s, f));
  },
};

const DataContext = createContext<DataSource>(demoSource);

export function DataProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  return <DataContext.Provider value={source}>{children}</DataContext.Provider>;
}

export const useData = (): DataSource => useContext(DataContext);

export type Resource<T> = { data: T | null; loading: boolean; error: Error | null };

/** A stable number per data source, so a request key can tell two sources apart. */
const sourceIds = new WeakMap<DataSource, number>();
let nextSourceId = 0;
function idOf(source: DataSource): number {
  let id = sourceIds.get(source);
  if (id === undefined) { id = nextSourceId++; sourceIds.set(source, id); }
  return id;
}

/**
 * Read one resource. `deps` behaves like `useEffect`'s, and a stale response is discarded
 * rather than overwriting a newer one.
 *
 * `loading` is derived — the stored result belongs to an older request key — rather than set
 * inside the effect, which would render twice per change. While a new request is in flight
 * the previous data stays on screen (a range switch should not blank a chart).
 */
export function useResource<T>(load: (source: DataSource) => Promise<T>, deps: unknown[] = []): Resource<T> {
  const source = useData();
  const key = `${idOf(source)}:${JSON.stringify(deps)}`;
  const [state, setState] = useState<{ key: string | null; data: T | null; error: Error | null }>({ key: null, data: null, error: null });

  useEffect(() => {
    let live = true;
    load(source)
      .then((data) => { if (live) setState({ key, data, error: null }); })
      .catch((error: Error) => { if (live) setState({ key, data: null, error }); });
    return () => { live = false; };
    // `load` is a fresh closure every render; `key` already captures what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key]);

  const current = state.key === key;
  return { data: state.data, loading: !current, error: current ? state.error : null };
}
