/**
 * What the screens need, independent of where it comes from.
 *
 * These are the shapes the API will return (P1 gives each one a zod contract). Keeping
 * them here means the dashboard can be built, reviewed and looked at before the API
 * exists — and when the API arrives, the screens do not change.
 */
import type { Bi } from './lang';
import type { PlanCode } from './plans';

export type TenantSummary = {
  id: string;
  name: string;
  slug: string;
  plan: PlanCode;
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  trialEndsAt: string | null;
  logoUrl: string | null;
  role: 'owner' | 'admin' | 'editor' | 'analyst' | 'viewer';
};

export type OnboardingStep = {
  key: 'account' | 'store' | 'connect' | 'catalogue' | 'first_model' | 'embed';
  title: Bi;
  description: Bi;
  href: string;
  done: boolean;
  /** Minutes, honestly estimated — an underestimate here is a broken promise later. */
  minutes: number;
};

export type MetricPoint = { day: string; views: number; arSessions: number; tryonSessions: number; purchases: number };

export type DashboardSummary = {
  tenant: TenantSummary;
  onboarding: { complete: boolean; steps: OnboardingStep[] };
  counts: { products: number; arEnabled: number; models: number; modelsReady: number; teamMembers: number };
  usage: { products: { used: number; limit: number }; arSessions: { used: number; limit: number }; aiCredits: { used: number; limit: number } };
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
  version: number;
  /** Optimised GLB size. The bandwidth bill and the AR load time are both this number. */
  sizeBytes: number;
  polyCount: number | null;
  formats: ('glb' | 'usdz')[];
  thumbnailUrl: string | null;
  updatedAt: string;
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
};

export type AnalyticsView = {
  range: '7d' | '30d' | '90d';
  totals: DashboardSummary['last30'];
  series: MetricPoint[];
  byDevice: { device: 'mobile' | 'tablet' | 'desktop'; sessions: number; arSupported: number }[];
  topProducts: { productId: string; name: string; views: number; arSessions: number; purchases: number; upliftPct: number | null }[];
  funnel: { step: Bi; value: number }[];
};
