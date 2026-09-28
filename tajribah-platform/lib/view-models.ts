/**
 * What the screens need, independent of where it comes from.
 *
 * These are the shapes the API will return (P1 gives each one a zod contract). Keeping
 * them here means the dashboard can be built, reviewed and looked at before the API
 * exists — and when the API arrives, the screens do not change.
 */
import type { AiJobStage } from './ai-jobs';
import type { Bi } from './lang';
import type { PlanCode } from './plans';
import type { SlotQuality } from './tryon-quality';
import type { ConnectionHealth } from './connection-health';

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  plan: PlanCode;
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  trialEndsAt: string | null;
  logoUrl: string | null;
  role: 'owner' | 'admin' | 'editor' | 'analyst' | 'viewer';
  /** P2.11: the trial or subscription ended — the store can read but not change things. */
  readOnly?: 'trial_ended' | 'subscription_ended' | null;
};

export type OnboardingStep = {
  key: 'account' | 'store' | 'connect' | 'catalogue' | 'first_model' | 'publish' | 'embed';
  title: Bi;
  description: Bi;
  href: string;
  done: boolean;
  /** P1.2: put off by the merchant (only `connect` here); not counted as left to do. */
  skipped: boolean;
  /** Minutes, honestly estimated — an underestimate here is a broken promise later. */
  minutes: number;
};

export type MetricPoint = { day: string; views: number; arSessions: number; tryonSessions: number; purchases: number };

export type DashboardSummary = {
  tenant: TenantSummary;
  onboarding: { complete: boolean; steps: OnboardingStep[] };
  counts: { products: number; arEnabled: number; models: number; modelsReady: number; teamMembers: number };
  /** P2.2: the same figures the quotas check (`currentUsage`), so a screen can never say "room left" while the API refuses. Storage in GB. */
  usage: { products: { used: number; limit: number }; arSessions: { used: number; limit: number }; aiCredits: { used: number; limit: number }; storage: { used: number; limit: number } };
  last30: {
    views: number; arSessions: number; tryonSessions: number;
    addToCart: number; purchases: number; revenueMinor: number;
    /** Conversion with AR minus conversion without it. Null until there is enough data to mean anything. */
    upliftPct: number | null;
    /** Return rate change, same rule. */
    returnDeltaPct: number | null;
  };
  series: MetricPoint[];
  connection: ConnectionSummary | null;
  activity: ActivityItem[];
};

/** One sync of one store connection, as the connections screen shows it (P1.6). */
export type SyncProgress = {
  id: string;
  connectionId: string;
  type: 'full' | 'incremental' | 'single_product' | 'inventory' | 'orders';
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  triggeredBy: 'schedule' | 'user' | 'webhook' | 'system';
  /** Items handled so far, failed ones included. */
  processed: number;
  failed: number;
  /** As the store reports it; 0 until the first page arrives. */
  total: number;
  /** Null while the total is unknown. Never above 100, even if the store's total was low. */
  percent: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

/** Webhook delivery health for one store connection (P1.7). */
export type WebhookHealth = {
  last24h: { waiting: number; processed: number; failed: number; ignored: number };
  lastDeliveryAt: string | null;
  /** The newest delivery that used up its attempts — the one to replay. */
  lastFailure: { id: string; topic: string; error: string | null; at: string } | null;
};

export type ConnectionSummary = {
  id: string;
  provider: 'salla' | 'zid' | 'shopify' | 'woocommerce';
  storeName: string;
  storeUrl: string | null;
  status: 'active' | 'expired' | 'revoked' | 'error';
  lastSyncAt: string | null;
  healthScore: number;
  productCount: number;
  lastError: string | null;
};

/** One store connection as the connections screen shows it (P1.11): no token, ever. */
export type ConnectionDetail = ConnectionSummary & {
  latestSync: SyncProgress | null;
  webhooks: WebhookHealth;
  /** P6.16 — computed now, with the reasons (`lib/connection-health.ts`). */
  health: ConnectionHealth;
};

/** T37: the product a page names, and whether its button is live (P1.15). */
export type Publication = { productId: string; name: string; nameAr: string | null; state: 'live' | 'not_published' | 'withdrawn'; version: number };

/** The install checker's answer (P1.17); `product` (T37) is null when no product has the page's id. */
export type InstallCheck =
  | { status: 'installed'; productRef: string; url: string; product: Publication | null }
  | { status: 'missing_script' | 'wrong_store' | 'missing_placeholder' | 'template_not_rendered' | 'unreachable'; detail: string | null; url: string };

/** One notification in the bell (P1.23). */
export type NotificationItem = {
  id: string;
  type: string;
  title: Bi;
  body: Bi | null;
  href: string | null;
  level: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: string;
};

export type ActivityItem = {
  id: string;
  kind: 'sync' | 'model' | 'publish' | 'billing' | 'team' | 'tryon';
  title: Bi;
  detail: Bi | null;
  at: string;
  level: 'info' | 'success' | 'warning' | 'error';
};

export type ProductRow = {
  id: string;
  name: string;
  nameAr: string | null;
  sku: string | null;
  imageUrl: string | null;
  priceMinor: number | null;
  currency: string;
  productType: 'jewelry' | 'watch' | 'eyewear' | 'bag' | 'apparel' | 'furniture' | 'other';
  status: 'active' | 'draft' | 'archived';
  arEnabled: boolean;
  tryonEnabled: boolean;
  modelStatus: 'none' | 'processing' | 'ready' | 'failed';
  /** Millimetres. Without these the size comparison cannot be true to scale. */
  dimensions: { widthMm?: number; heightMm?: number; depthMm?: number; caseMm?: number } | null;
  views30: number;
  arSessions30: number;
  updatedAt: string;
};

export type ModelRow = {
  id: string;
  productId: string | null;
  productName: string | null;
  name: string;
  source: 'uploaded' | 'ai_generated' | 'professional_service';
  status: 'draft' | 'processing' | 'ready' | 'failed' | 'archived';
  qaStatus: 'pending' | 'approved' | 'rejected';
  /** P3.6: the reviewer's note (or post-processing's) — shown to the merchant on a generated model. */
  qaNotes: string | null;
  version: number;
  /** Optimised GLB size. The bandwidth bill and the AR load time are both this number. */
  sizeBytes: number;
  polyCount: number | null;
  formats: ('glb' | 'usdz')[];
  thumbnailUrl: string | null;
  updatedAt: string;
};

/** One version of a model, for the library's version list (P1.12–P1.14). */
export type ModelVersionRow = {
  id: string;
  version: number;
  status: 'draft' | 'processing' | 'ready' | 'failed' | 'archived';
  /** Computed from `models_3d.current_version_id` — never stored on the version (db/schema/ar.ts). */
  isCurrent: boolean;
  polyCount: number | null;
  originalBytes: number | null;
  optimizedBytes: number | null;
  /** Optimised file ≤ 2 MB. Null until there is an optimised file to measure. */
  withinTarget: boolean | null;
  /** Why a `failed` version failed, in the checker's (English) words. */
  error: string | null;
  /** P3.8: the model's size as processed (width, height, depth in mm); null until measured. */
  sizeMm: [number, number, number] | null;
  createdAt: string;
};

export type TeamMemberRow = {
  id: string;
  fullName: string;
  email: string;
  role: 'owner' | 'admin' | 'editor' | 'analyst' | 'viewer';
  status: 'active' | 'invited' | 'suspended';
  lastLoginAt: string | null;
};

export type InvoiceRow = {
  id: string;
  number: string;
  status: 'draft' | 'issued' | 'paid' | 'void' | 'refunded';
  subtotalMinor: number;
  vatMinor: number;
  totalMinor: number;
  currency: string;
  issuedAt: string | null;
  paidAt: string | null;
  /** Null until the ZATCA provider has returned a cleared document. Never fabricated. */
  zatcaStatus: 'pending' | 'reported' | 'cleared' | 'failed' | null;
};

export type BillingSummary = {
  plan: PlanCode;
  status: 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired' | 'none';
  cycle: 'monthly' | 'annual';
  renewsAt: string | null;
  trialEndsAt: string | null;
  priceMinor: number | null;
  currency: string;
  aiCredits: { balance: number; grantedThisPeriod: number; usedThisPeriod: number };
  invoices: InvoiceRow[];
  /** Null means no payment method on file — the merchant sees "add one", not a fake card. */
  paymentMethod: { type: 'mada' | 'card' | 'applepay' | 'stcpay'; last4: string; expiry: string } | null;
  /** P2.10: list prices from the plan rows (P2.1) — what a checkout quotes. Null = "talk to us". */
  catalogue: { code: PlanCode; priceMonthlyMinor: number | null; priceAnnualMinor: number | null }[];
};

export type AnalyticsView = {
  range: '7d' | '30d' | '90d';
  /** T35: `basic` (Starter) — totals, daily chart, devices; `full` adds conversion, funnel, top products, export. */
  level: 'basic' | 'full';
  totals: DashboardSummary['last30'];
  series: MetricPoint[];
  byDevice: { device: 'mobile' | 'tablet' | 'desktop'; sessions: number; arSupported: number }[];
  topProducts: { productId: string; name: string; views: number; arSessions: number; tryonSessions: number; purchases: number; upliftPct: number | null }[];
  funnel: { step: Bi; value: number }[];
  /**
   * P4.6 — the two groups behind the uplift, so a merchant can see what it rests on.
   * `verdict`: whether the gap could be chance (two-proportion test at 95%); null with no uplift.
   */
  conversion: {
    withAr: { sessions: number; purchases: number };
    withoutAr: { sessions: number; purchases: number };
    upliftPct: number | null;
    verdict: 'likely-real' | 'could-be-chance' | null;
  };
};

/**
 * P3.2 — one AI job as the merchant sees it. `percent` never goes backwards and is 100 only
 * when done; `error` is the merchant's wording for the code, never the provider's message.
 */
export type AiJobView = {
  id: string;
  type: 'generate_3d' | 'enhance_texture' | 'embed_product' | 'enrich_content' | 'quality_check' | 'convert_format';
  status: 'queued' | 'processing' | 'done' | 'failed' | 'cancelled';
  percent: number;
  stage: AiJobStage | null;
  creditsCost: number;
  /** True once the credits a failed or cancelled job took have been given back. */
  refunded: boolean;
  error: { code: string; message: Bi } | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  canCancel: boolean;
};

/** P3.3 — one product photo for 3D generation, as the merchant sees it after the check. */
export type GenerationPhotoView = {
  id: string;
  angle: 'front' | 'side' | 'back' | 'detail';
  status: 'uploading' | 'accepted' | 'rejected';
  format: 'jpeg' | 'png' | 'webp' | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  /** About the file (size and shape), not the picture; null until checked or when refused. */
  score: number | null;
  issues: { code: string; blocking: boolean; message: Bi }[];
  createdAt: string;
};

export type GenerationPhotoSet = {
  photos: GenerationPhotoView[];
  /** A generation needs an accepted front photo; more angles make a better model. */
  ready: boolean;
  /** Angles with no accepted photo yet, front first. */
  missing: ('front' | 'side' | 'back')[];
};

/** P5.10 — one watch's try-on settings, as the merchant sees them (T26: the owner's studio). */
export type TryOnWatchView = {
  productId: string;
  name: string;
  nameAr: string | null;
  sku: string | null;
  /** The product's own width, offered as the case width when none is set yet. */
  productWidthMm: number | null;
  caseMm: number | null;
  worn: { bytes: number } | null;
  flat: { bytes: number } | null;
  finish: Bi | null;
  enabled: boolean;
  /** Both pictures and a case width: the shop's button can open the studio. */
  ready: boolean;
  missing: ('worn' | 'flat' | 'case')[];
  /**
   * P5.13 — the last 30 Riyadh days on this watch's page, from the analytics rollup: views and
   * try-on openings. Only on the screen's list, and null when the viewer may not read analytics.
   */
  last30: { views: number; tryonSessions: number } | null;
  /**
   * P5.9 — each picture's check (null while it is being checked), and the watch's score: the
   * worse picture's share of its real size, 0–100, once both are checked.
   */
  quality: { worn: SlotQuality | null; flat: SlotQuality | null; score: number | null };
};

export type TryOnScreen = {
  /**
   * T33: every plan sets watches up for the studio (on the model, true-size comparison); this says
   * whether shoppers may also try them on their own photo — `virtual_tryon`, Pro and Enterprise.
   */
  onMe: boolean;
  watches: TryOnWatchView[];
};
