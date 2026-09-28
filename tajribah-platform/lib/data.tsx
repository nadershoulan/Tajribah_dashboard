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
  DEMO_ANALYTICS, DEMO_BILLING, DEMO_CONNECTION, DEMO_DASHBOARD, DEMO_MODELS, DEMO_NOTIFICATIONS, DEMO_PRODUCTS, DEMO_SYNC, DEMO_TEAM, DEMO_WEBHOOKS, demoTryonSessions30,
} from './demo-data';
import type {
  AnalyticsView, BillingSummary, ConnectionDetail, DashboardSummary, GenerationPhotoSet, GenerationPhotoView, TryOnScreen, TryOnWatchView, InstallCheck, ModelRow, ModelVersionRow, NotificationItem, ProductRow, SyncProgress, TeamMemberRow, TenantSummary,
} from './view-models';
import { ANGLE_SLOTS, PHOTO_ISSUES, photoIssueViews, type GenerationAngle } from './ai-jobs';
import { MAX_PHOTO_BYTES, PHOTO_CONTENT_TYPES, checkPhoto, sha256Hex } from '@/server/modules/ai-jobs/photo-check';
import { checkCutout } from '@/server/modules/tryon/cutout';
import { CUTOUT_ISSUES } from './tryon';
import { alphaFacts, hasMargins, qualityScore, sizeShown, type SlotQuality } from './tryon-quality';
import { healthOf } from './connection-health';
import { ApiError, currentStore, type ApiClient } from './api-client';
import type { Bi, Lang } from './lang';
import type { ProductListPage, ProductListQuery } from './contracts/products';
import type { PlanCode } from './plans';
import { DEFAULT_BUTTON_RADIUS, SettingsPatch, type StoreSettings } from './contracts/settings';
import { ArConfigInput, DEFAULT_AR_CONFIG, defaultLabelsFor, placementErrors, placementsFor, type ArConfigView, type PublishResult } from './contracts/ar-config';
import { pageOf } from './product-list';
import { MODEL_TARGET_BYTES } from './model-size';
import { embedSnippet } from '../widget/src/snippet';
import { applyEdit, editErrors, type ProductEdit } from './product-edit';
import { STEP_COPY } from './onboarding-steps';
import { priceInvoiceLines, type InvoiceDocument } from './contracts/invoices';
import { SELLER, addressLine } from '@/server/core/billing/seller';
import { slugProblem } from './slug';
import type { OnboardingState } from '@/db/schema';
import {
  OnboardingError, confirmStore as confirmStoreRule, evaluate, skip as skipRule, unskip as unskipRule,
  type Facts, type OnboardingView, type StepKey,
} from '@/server/modules/onboarding/machine';

/** A13 (T23) — server/modules/notifications/service.ts `LiveAnnouncement`. */
export type Announcement = { id: string; level: 'info' | 'warning'; title: Bi; body: Bi | null; link: string | null; endsAt: string };

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
  /** P3.3/P3.7: a product's photos for 3D generation, and whether a generation could start. */
  productPhotos(productId: string): Promise<GenerationPhotoSet>;
  /** Start → PUT straight to storage → the server's verdict on the bytes. Refusals before upload: 422 / 409. */
  uploadProductPhoto(productId: string, angle: GenerationAngle, file: File): Promise<GenerationPhotoView>;
  removeProductPhoto(productId: string, photoId: string): Promise<void>;
  /** P5.10: every watch and its try-on settings, and whether the plan includes try-on. */
  tryOn(): Promise<TryOnScreen>;
  /** P5.10: start → PUT straight to storage → the server's check of the picture (422 with the reason). */
  uploadCutout(productId: string, slot: 'worn' | 'flat', file: File): Promise<TryOnWatchView>;
  updateTryOn(productId: string, patch: { caseMm?: number | null; finishAr?: string | null; finishEn?: string | null; enabled?: boolean }): Promise<TryOnWatchView>;
  /** P5.10: a stored picture, for the preview (a Blob: private until published). */
  cutoutImage(productId: string, slot: 'worn' | 'flat'): Promise<Blob>;
  /** P3.8: a version's web GLB, for the editor's viewer (a Blob: the viewer's own fetch has no session). */
  modelFile(versionId: string): Promise<Blob>;
  /** P3.8: turn (90° steps) and/or fit a ready version; the result is the next version, processing. */
  editModel(modelId: string, edit: { fromVersionId: string; rotate?: { x?: 0 | 90 | 180 | 270; y?: 0 | 90 | 180 | 270; z?: 0 | 90 | 180 | 270 }; fit?: boolean }): Promise<{ versionId: string; version: number }>;
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
  /** A13 (T23): platform notices live now, for every dashboard. */
  announcements(): Promise<Announcement[]>;
  markNotificationsRead(ids: string[] | 'all'): Promise<void>;
  /** P1.21: AR button and viewer settings per product. */
  arConfigs(): Promise<ArConfigView[]>;
  saveArConfig(productId: string, input: ArConfigInput): Promise<ArConfigView>;
  /** P1.15 — publish the product's config to the store shops read. */
  publishArConfig(productId: string): Promise<PublishResult>;
  /** T40 — take the product off the shop. */
  unpublishArConfig(productId: string): Promise<PublishResult>;
  updateSettings(patch: Record<string, unknown>): Promise<StoreSettings>;
  analytics(range: '7d' | '30d' | '90d'): Promise<AnalyticsView>;
  /** P4.8: the range's daily figures as CSV text. */
  analyticsCsv(range: '7d' | '30d' | '90d'): Promise<string>;
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
    async productPhotos(productId) {
      return client.call<GenerationPhotoSet>(`/api/products/${encodeURIComponent(productId)}/photos`);
    },
    async uploadProductPhoto(productId, angle, file) {
      const base = `/api/products/${encodeURIComponent(productId)}/photos`;
      const started = await client.call<{ photoId: string; uploadUrl: string; contentType: string }>(base, {
        method: 'POST', body: { angle, filename: file.name, contentType: photoContentType(file), sizeBytes: file.size },
      });
      // Straight to storage, as for models: the signature in the URL is the permission.
      const put = await fetch(started.uploadUrl, { method: 'PUT', headers: { 'content-type': started.contentType }, body: file });
      if (!put.ok) throw new ApiError(put.status, 'upload_failed', 'the photo did not reach storage — try again');
      return client.call<GenerationPhotoView>(`${base}/${encodeURIComponent(started.photoId)}/confirm`, { method: 'POST' });
    },
    async removeProductPhoto(productId, photoId) {
      await client.call<void>(`/api/products/${encodeURIComponent(productId)}/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' });
    },
    async modelFile(versionId) {
      return client.callBlob(`/api/models/versions/${encodeURIComponent(versionId)}/file`);
    },
    async tryOn() { return client.call<TryOnScreen>('/api/tryon'); },
    async uploadCutout(productId, slot, file) {
      const base = `/api/tryon/${encodeURIComponent(productId)}/images`;
      const started = await client.call<{ key: string; uploadUrl: string; contentType: string }>(base, {
        method: 'POST', body: { slot, filename: file.name, contentType: photoContentType(file), sizeBytes: file.size },
      });
      const put = await fetch(started.uploadUrl, { method: 'PUT', headers: { 'content-type': started.contentType }, body: file });
      if (!put.ok) throw new ApiError(put.status, 'upload_failed', 'the picture did not reach storage — try again');
      return client.call<TryOnWatchView>(`${base}/confirm`, { method: 'POST', body: { slot, key: started.key } });
    },
    async updateTryOn(productId, patch) {
      return client.call<TryOnWatchView>(`/api/tryon/${encodeURIComponent(productId)}`, { method: 'PATCH', body: patch });
    },
    async cutoutImage(productId, slot) {
      return client.callBlob(`/api/tryon/${encodeURIComponent(productId)}/images/${slot}`);
    },
    async editModel(modelId, edit) {
      return client.call<{ versionId: string; version: number }>(`/api/models/${encodeURIComponent(modelId)}/edit`, { method: 'POST', body: edit });
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
    async announcements() { return (await client.call<{ announcements: Announcement[] }>('/api/announcements')).announcements; },
    async embed() { return client.call<{ storeKey: string; snippet: string; storeHost: string | null }>('/api/embed'); },
    async checkInstall(url) { return client.call<InstallCheck>('/api/embed/check', { method: 'POST', body: { url } }); },
    async markNotificationsRead(ids) {
      await client.call('/api/notifications/read', { method: 'POST', body: ids === 'all' ? { all: true } : { ids } });
    },
    async saveArConfig(productId, input) {
      return client.call<ArConfigView>(`/api/ar-configs/${encodeURIComponent(productId)}`, { method: 'PUT', body: input });
    },
    async publishArConfig(productId) {
      return client.call<PublishResult>(`/api/ar-configs/${encodeURIComponent(productId)}/publish`, { method: 'POST' });
    },
    async unpublishArConfig(productId) {
      return client.call<PublishResult>(`/api/ar-configs/${encodeURIComponent(productId)}/publish`, { method: 'DELETE' });
    },
    async updateSettings(patch) { return client.call<StoreSettings>('/api/settings', { method: 'PATCH', body: patch }); },
    async analytics(range) { return client.call<AnalyticsView>(`/api/analytics?range=${range}`); },
    async analyticsCsv(range) { return client.callText(`/api/analytics/export?range=${range}`); },
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
    seller: { name: SELLER.nameEn, nameAr: SELLER.nameAr, crNumber: SELLER.crNumber, vatNumber: SELLER.vatNumber, address: addressLine(SELLER.address, 'en'), addressAr: addressLine(SELLER.address, 'ar') },
    buyer: { name: 'Failet', nameAr: 'فايلت', crNumber: null, vatNumber: null, address: null },
    zatca: { status: null, qr: null },
  };
}

/**
 * What the browser says a picked file is. Some pickers leave `type` empty; the extension is the
 * fallback. The server judges the bytes either way — this only gets the upload started.
 */
export function photoContentType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

/** Seeded data, resolved on a microtask so screens exercise their loading states. */
/** The preview's edits, for this page load only: the preview has nowhere to save them. */
const demoEdits = new Map<string, ProductRow>();
const demoTeam: TeamMemberRow[] = DEMO_TEAM.map((m) => ({ ...m }));
const demoArConfigs = new Map<string, ArConfigView>();
const demoNotifications: NotificationItem[] = DEMO_NOTIFICATIONS.map((n) => ({ ...n }));
/** T42: live in the preview = published in its AR settings. */
function withLive(p: ProductRow): ProductRow {
  return { ...p, live: (demoArConfigs.get(p.id)?.publishedVersion ?? 0) > 0 };
}
function demoArDefault(p: ProductRow): ArConfigView {
  return {
    productId: p.id, productName: p.name, productNameAr: p.nameAr, productType: p.productType, arEnabled: p.arEnabled,
    ...defaultLabelsFor(p.productType), variant: DEFAULT_AR_CONFIG.variant,
    showIcon: DEFAULT_AR_CONFIG.showIcon, placement: placementsFor(p.productType)[0], scale: 1, autoRotate: true, shadow: 1,
    saved: false, publishedVersion: 0, publishedAt: null, unpublishedChanges: false,
  };
}
/** The preview store's settings: blank identity fields, as a new merchant has (§11). */
const demoSettings: StoreSettings = {
  slug: DEMO_DASHBOARD.tenant.slug, name: DEMO_DASHBOARD.tenant.name, nameAr: null, crNumber: null, vatNumber: null,
  nationalAddress: null, city: null, brandColor: null, buttonRadius: DEFAULT_BUTTON_RADIUS, consentTextAr: null, consentTextEn: null,
};
const demoModels: ModelRow[] = DEMO_MODELS.map((m) => ({ ...m }));
/**
 * P3.7 — the preview's product photos, for this page load. The preview has no storage, so the
 * check runs here, in the browser: the same `checkPhoto` the server runs, on the file you picked.
 */
const demoPhotos = new Map<string, { view: GenerationPhotoView; sha: string }[]>();
/** P5.10 — the preview's try-on settings, per watch, for this page load; pictures kept as Blobs. */
const demoTryOn = new Map<string, { worn: Blob | null; flat: Blob | null; caseMm: number | null; finish: { ar: string; en: string } | null; enabled: boolean; quality?: { worn?: SlotQuality; flat?: SlotQuality } }>();
/**
 * P5.9 in the preview: the worker's check, on a canvas — the same `alphaFacts`; empty edges
 * cropped away, the share of real size measured.
 */
async function demoCutoutQuality(file: Blob, slot: 'worn' | 'flat'): Promise<{ picture: Blob; quality: SlotQuality }> {
  const key = `preview:${slot}:${Date.now()}`;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const g = canvas.getContext('2d')!;
    g.drawImage(bitmap, 0, 0);
    const facts = alphaFacts(g.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height);
    if (!facts.box) return { picture: file, quality: { key, sizeShown: 0, trimmed: false, issue: 'empty' } };
    if (!hasMargins(facts)) return { picture: file, quality: { key, sizeShown: sizeShown(facts), trimmed: false } };
    const { left, top, width, height } = facts.box;
    const cut = document.createElement('canvas');
    cut.width = width; cut.height = height;
    cut.getContext('2d')!.drawImage(canvas, left, top, width, height, 0, 0, width, height);
    const picture = await new Promise<Blob>((done) => cut.toBlob((b) => done(b ?? file), 'image/png'));
    return { picture, quality: { key, sizeShown: sizeShown(facts), trimmed: true } };
  } catch {
    return { picture: file, quality: { key, sizeShown: 0, trimmed: false, issue: 'unreadable' } };
  }
}
/** The preview store's plan (Growth): watches can be set up; trying on the shopper's own photo is Pro (T33). */
const DEMO_TRYON_ON_ME = false;
function demoTryOnView(p: ProductRow): TryOnWatchView {
  const s = demoTryOn.get(p.id) ?? { worn: null, flat: null, caseMm: null, finish: null, enabled: false };
  const missing: TryOnWatchView['missing'] = [];
  if (!s.worn) missing.push('worn');
  if (!s.flat) missing.push('flat');
  if (s.caseMm === null) missing.push('case');
  return {
    productId: p.id, name: p.name, nameAr: p.nameAr, sku: p.sku, productWidthMm: p.dimensions?.widthMm ?? null, caseMm: s.caseMm,
    worn: s.worn ? { bytes: s.worn.size } : null, flat: s.flat ? { bytes: s.flat.size } : null, finish: s.finish,
    enabled: s.enabled && missing.length === 0, ready: missing.length === 0, missing,
    last30: { views: p.views30, tryonSessions: demoTryonSessions30(p) },
    quality: {
      worn: s.worn ? s.quality?.worn ?? null : null,
      flat: s.flat ? s.quality?.flat ?? null : null,
      score: s.worn && s.flat ? qualityScore(s.quality?.worn, s.quality?.flat) : null,
    },
  };
}
/** Which version is live per demo model, when it is not the newest. */
const demoLive = new Map<string, number>();
/** Versions 1…n of a demo model; older ready versions stand in for rollbacks. */
function demoVersionsOf(model: ModelRow): ModelVersionRow[] {
  // T25: a generated model is never live before review, in the preview as on the server.
  const held = model.source === 'ai_generated' && model.qaStatus !== 'approved';
  const live = demoLive.get(model.id) ?? (model.status === 'ready' && !held ? model.version : 0);
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
      sizeMm: null, // the preview's models are rows, not files
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
    // P6.16: the server's own rule, on the demo's facts.
    health: healthOf({
      status: demoConnectionState.status, createdAt: new Date(Date.now() - 30 * 86_400_000),
      lastSyncAt: demoConnectionState.lastSyncAt ? new Date(demoConnectionState.lastSyncAt) : null, syncIntervalMinutes: 60,
      failedSyncsInRow: 0, webhooks24h: { processed: DEMO_WEBHOOKS.last24h.processed, failed: DEMO_WEBHOOKS.last24h.failed }, oldestWaitingAt: null,
    }, new Date()),
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
    hasReadyTryOn: false,
    hasLiveConfig: [...demoArConfigs.values()].some((c) => c.publishedVersion > 0),
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
  async products(query = {}) { return pageOf(DEMO_PRODUCTS.map((p) => withLive(demoEdits.get(p.id) ?? p)), query); },
  async product(id) { const p = demoEdits.get(id) ?? DEMO_PRODUCTS.find((x) => x.id === id); return p ? withLive(p) : null; },
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
    if (model.source === 'ai_generated' && model.qaStatus !== 'approved') throw new ApiError(409, 'conflict', 'this generated model is waiting for review by Tajribah before it can go live');
    demoLive.set(model.id, Number(n));
  },
  async uploadModel(file) {
    // The preview has no storage and no worker: the upload is accepted and stays processing.
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'glb' && ext !== 'usdz') throw new ApiError(422, 'validation_failed', 'Validation failed', { filename: ['only .glb and .usdz files can be uploaded'] });
    const model: ModelRow = {
      id: `m-upload-${demoModels.length + 1}`, productId: null, productName: null, name: file.name.replace(/\.[^.]+$/, ''),
      source: 'uploaded', status: 'processing', qaStatus: 'pending', qaNotes: null, version: 1, sizeBytes: 0, polyCount: null,
      formats: [], thumbnailUrl: null, updatedAt: new Date().toISOString(),
    };
    demoModels.unshift(model);
    return { modelId: model.id, status: 'processing', error: null };
  },
  async productPhotos(productId) {
    if (!DEMO_PRODUCTS.some((p) => p.id === productId)) throw new ApiError(404, 'not_found', 'product not found');
    const photos = (demoPhotos.get(productId) ?? []).map((p) => ({ ...p.view }));
    const accepted = new Set(photos.filter((p) => p.status === 'accepted').map((p) => p.angle));
    return { photos, ready: accepted.has('front'), missing: (['front', 'side', 'back'] as const).filter((a) => !accepted.has(a)) };
  },
  async uploadProductPhoto(productId, angle, file) {
    if (!DEMO_PRODUCTS.some((p) => p.id === productId)) throw new ApiError(404, 'not_found', 'product not found');
    // The server's refusals before a byte is sent, in the same words.
    if (!Object.values(PHOTO_CONTENT_TYPES).includes(photoContentType(file))) {
      throw new ApiError(422, 'validation_failed', 'Validation failed', { contentType: [PHOTO_ISSUES.unsupported_format.en] });
    }
    if (file.size > MAX_PHOTO_BYTES) throw new ApiError(422, 'validation_failed', 'Validation failed', { sizeBytes: [PHOTO_ISSUES.too_large_file.en] });
    const list = demoPhotos.get(productId) ?? [];
    const taken = list.filter((p) => p.view.angle === angle && p.view.status !== 'rejected').length;
    if (taken >= ANGLE_SLOTS[angle]) {
      throw new ApiError(409, 'conflict', ANGLE_SLOTS[angle] === 1
        ? `this product already has a ${angle} photo — remove it first`
        : `this product already has ${taken} ${angle} photos — remove one first`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha = await sha256Hex(bytes);
    const known = list.filter((p) => p.view.status === 'accepted').map((p) => p.sha);
    const verdict = checkPhoto(bytes, file.size, sha, known);
    const view: GenerationPhotoView = {
      id: `photo-${Date.now()}-${list.length}`, angle, status: verdict.accepted ? 'accepted' : 'rejected',
      format: verdict.facts?.format ?? null, width: verdict.facts?.width ?? null, height: verdict.facts?.height ?? null,
      sizeBytes: file.size, score: verdict.score, issues: photoIssueViews(verdict.issues), createdAt: new Date().toISOString(),
    };
    demoPhotos.set(productId, [...list, { view, sha }]);
    return { ...view };
  },
  async removeProductPhoto(productId, photoId) {
    const list = demoPhotos.get(productId) ?? [];
    if (!list.some((p) => p.view.id === photoId)) throw new ApiError(404, 'not_found', 'photo not found');
    demoPhotos.set(productId, list.filter((p) => p.view.id !== photoId));
  },
  async modelFile() {
    throw new ApiError(404, 'not_found', 'the preview has no 3D files — open a model in the live dashboard to see it');
  },
  async tryOn() {
    return { onMe: DEMO_TRYON_ON_ME, watches: DEMO_PRODUCTS.filter((p) => p.productType === 'watch').map(demoTryOnView) };
  },
  async uploadCutout(productId, slot, file) {
    const p = DEMO_PRODUCTS.find((x) => x.id === productId && x.productType === 'watch');
    if (!p) throw new ApiError(404, 'not_found', 'product not found');
    const verdict = checkCutout(new Uint8Array(await file.arrayBuffer()), file.size);
    if (!verdict.ok) throw new ApiError(422, 'validation_failed', 'Validation failed', { [slot]: [CUTOUT_ISSUES[verdict.issue].en] });
    const s = demoTryOn.get(p.id) ?? { worn: null, flat: null, caseMm: null, finish: null, enabled: false };
    const checked = await demoCutoutQuality(file, slot);
    demoTryOn.set(p.id, { ...s, [slot]: checked.picture, quality: { ...s.quality, [slot]: checked.quality } });
    return demoTryOnView(p);
  },
  async updateTryOn(productId, patch) {
    const p = DEMO_PRODUCTS.find((x) => x.id === productId && x.productType === 'watch');
    if (!p) throw new ApiError(404, 'not_found', 'product not found');
    const s = demoTryOn.get(p.id) ?? { worn: null, flat: null, caseMm: null, finish: null, enabled: false };
    const next = { ...s };
    if (patch.caseMm !== undefined) next.caseMm = patch.caseMm;
    if (patch.finishAr !== undefined || patch.finishEn !== undefined) next.finish = patch.finishAr?.trim() && patch.finishEn?.trim() ? { ar: patch.finishAr.trim(), en: patch.finishEn.trim() } : null;
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    demoTryOn.set(p.id, next);
    const shown = demoTryOnView(p);
    if (next.enabled && shown.missing.length) { demoTryOn.set(p.id, s); throw new ApiError(409, 'conflict', `try-on cannot be switched on yet — missing: ${shown.missing.join(', ')}`); }
    return shown;
  },
  async cutoutImage(productId, slot) {
    const picture = demoTryOn.get(productId)?.[slot];
    if (!picture) throw new ApiError(404, 'not_found', 'picture not found');
    return picture;
  },
  async editModel() {
    throw new ApiError(409, 'conflict', 'the preview cannot make new versions — this works in the live dashboard');
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
  // The preview has no staff to publish one: no invented notices.
  async announcements() { return []; },
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
    const view = { ...demoArDefault(product), ...parsed.data!, saved: true, unpublishedChanges: true, publishedVersion: demoArConfigs.get(productId)?.publishedVersion ?? 0, publishedAt: demoArConfigs.get(productId)?.publishedAt ?? null };
    demoArConfigs.set(productId, view);
    return view;
  },
  async publishArConfig(productId) {
    // The preview's own copy only — no shop reads it. Same refusal as the server for a product with nothing to open.
    const product = DEMO_PRODUCTS.find((p) => p.id === productId);
    if (!product) throw new ApiError(404, 'not_found', 'product not found');
    if (!product.arEnabled) throw new ApiError(409, 'conflict', 'cannot publish: nothing for the button to open yet — switch AR on with a live 3D model, or set up the watch’s try-on');
    const view = demoArConfigs.get(productId) ?? demoArDefault(product);
    const published = { ...view, publishedVersion: view.publishedVersion + 1, publishedAt: new Date().toISOString(), unpublishedChanges: false };
    demoArConfigs.set(productId, published);
    return { version: published.publishedVersion, publishedAt: published.publishedAt, outdated: false };
  },
  async unpublishArConfig(productId) {
    const view = demoArConfigs.get(productId);
    if (!view || view.publishedVersion === 0) throw new ApiError(409, 'conflict', 'this product is not published');
    demoArConfigs.set(productId, { ...view, publishedVersion: 0, publishedAt: null, unpublishedChanges: view.saved });
    return { version: 0, publishedAt: null, outdated: false };
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
  async analyticsCsv(range) {
    // The preview's own demo series, labelled as such in the file name the screen gives it.
    const view = await this.analytics(range);
    return ['day,views,ar_sessions,tryon_sessions,purchases', ...view.series.map((p) => [p.day, p.views, p.arSessions, p.tryonSessions, p.purchases].join(','))].join('\r\n') + '\r\n';
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
