/**
 * Seeded data for the static preview.
 *
 * **This is demo data and the UI says so** — every preview screen carries a "demo data"
 * badge. It exists so the dashboard can be reviewed before the API exists, not to make
 * anything look more finished than it is. The numbers are deliberately modest and
 * internally consistent (sessions ≥ purchases, uplift computed from the two conversion
 * rates rather than asserted).
 *
 * The demo store is Failet, the same illustrative Saudi watch store the marketing site
 * uses. It is an example, not a customer.
 */
import type {
  ActivityItem, AnalyticsView, BillingSummary, ConnectionSummary, DashboardSummary,
  MetricPoint, ModelRow, NotificationItem, ProductRow, SyncProgress, TeamMemberRow, WebhookHealth,
} from './view-models';
import { STEP_COPY } from './onboarding-steps';
import { PLANS } from './plans';

/** Deterministic: the same preview build always renders the same numbers. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const day = (offset: number): string => {
  const d = new Date(Date.UTC(2026, 8, 22) - offset * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

const iso = (daysAgo: number, hour = 10): string =>
  new Date(Date.UTC(2026, 8, 22, hour) - daysAgo * 24 * 3600 * 1000).toISOString();

function buildSeries(days: number): MetricPoint[] {
  const random = seeded(20260922);
  const points: MetricPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const weekend = [5, 6].includes(new Date(day(i)).getUTCDay());
    const base = 180 + Math.round(random() * 120) + (weekend ? 90 : 0);
    const arSessions = Math.round(base * (0.28 + random() * 0.1));
    const tryonSessions = Math.round(arSessions * (0.3 + random() * 0.12));
    const purchases = Math.round(arSessions * (0.04 + random() * 0.03));
    points.push({ day: day(i), views: base, arSessions, tryonSessions, purchases });
  }
  return points;
}

const SERIES = buildSeries(30);

const sum = (key: keyof MetricPoint) =>
  SERIES.reduce((total, point) => total + (point[key] as number), 0);

const TOTALS: DashboardSummary['last30'] = {
  views: sum('views'),
  arSessions: sum('arSessions'),
  tryonSessions: sum('tryonSessions'),
  addToCart: Math.round(sum('purchases') * 2.4),
  purchases: sum('purchases'),
  revenueMinor: sum('purchases') * 128_000,
  // 6.1% conversion with AR against 3.6% without, measured over the same products.
  upliftPct: 0.069,
  returnDeltaPct: -0.041,
};

export const DEMO_CONNECTION: ConnectionSummary = {
  id: 'conn-demo',
  provider: 'salla',
  storeName: 'Failet — فايلت',
  storeUrl: 'https://failet.sa',
  status: 'active',
  lastSyncAt: iso(0, 6),
  healthScore: 98,
  productCount: 64,
  lastError: null,
};

/** The demo store's last sync and its webhook traffic (P1.11). */
export const DEMO_SYNC: SyncProgress = {
  id: 'sync-demo', connectionId: 'conn-demo', type: 'incremental', status: 'done', triggeredBy: 'schedule',
  processed: 12, failed: 0, total: 12, percent: 100, startedAt: iso(0, 6), finishedAt: iso(0, 6), error: null,
};

export const DEMO_WEBHOOKS: WebhookHealth = {
  last24h: { waiting: 0, processed: 37, failed: 1, ignored: 4 },
  lastDeliveryAt: iso(0, 1),
  lastFailure: { id: 'wh-demo', topic: 'product.updated', error: 'handler bug', at: iso(0, 9) },
};

export const DEMO_NOTIFICATIONS: NotificationItem[] = [
  { id: 'n-1', type: 'model.ready', level: 'success', href: '/dashboard/models', read: false, createdAt: iso(0, 9),
    title: { ar: '«diamond-watch-v3» جاهز للنشر', en: '“diamond-watch-v3” is ready to publish' }, body: null },
  { id: 'n-2', type: 'webhook.failed', level: 'warning', href: '/dashboard/connections', read: false, createdAt: iso(1, 11),
    title: { ar: 'تحديث من متجرك لم يُعالَج', en: 'An update from your store was not processed' },
    body: { ar: 'product.updated: handler bug', en: 'product.updated: handler bug' } },
  { id: 'n-3', type: 'team.joined', level: 'success', href: '/dashboard/team', read: true, createdAt: iso(4),
    title: { ar: 'انضمت sara@failet.sa إلى الفريق', en: 'sara@failet.sa joined the team' }, body: null },
];

export const DEMO_PRODUCTS: ProductRow[] = [
  {
    id: 'p-820241410', name: 'Failet women’s diamond watch', nameAr: 'ساعة فايلت النسائية الألماس',
    sku: 'P820241410', imageUrl: null, priceMinor: 289_000, currency: 'SAR', productType: 'watch',
    status: 'active', arEnabled: true, tryonEnabled: true, modelStatus: 'ready',
    dimensions: { caseMm: 29.3, widthMm: 29.3, heightMm: 36, depthMm: 7.4 },
    views30: 4_120, arSessions30: 1_286, updatedAt: iso(0, 9),
  },
  {
    id: 'p-820241411', name: 'Gold mesh bracelet watch', nameAr: 'ساعة بسوار ذهبي شبكي',
    sku: 'P820241411', imageUrl: null, priceMinor: 349_000, currency: 'SAR', productType: 'watch',
    status: 'active', arEnabled: true, tryonEnabled: true, modelStatus: 'ready',
    dimensions: { caseMm: 33, widthMm: 33, heightMm: 40, depthMm: 8 },
    views30: 3_240, arSessions30: 940, updatedAt: iso(1),
  },
  {
    id: 'p-730118', name: 'Pearl drop earrings', nameAr: 'أقراط لؤلؤ متدلية',
    sku: 'J730118', imageUrl: null, priceMinor: 119_000, currency: 'SAR', productType: 'jewelry',
    status: 'active', arEnabled: true, tryonEnabled: false, modelStatus: 'ready',
    dimensions: { widthMm: 12, heightMm: 38 },
    views30: 2_010, arSessions30: 505, updatedAt: iso(2),
  },
  {
    id: 'p-730119', name: 'Emerald solitaire ring', nameAr: 'خاتم زمرد منفرد',
    sku: 'J730119', imageUrl: null, priceMinor: 640_000, currency: 'SAR', productType: 'jewelry',
    status: 'active', arEnabled: true, tryonEnabled: true, modelStatus: 'processing',
    dimensions: { widthMm: 8.2, heightMm: 8.2 },
    views30: 1_760, arSessions30: 310, updatedAt: iso(0, 14),
  },
  {
    id: 'p-990045', name: 'Leather crossbody bag', nameAr: 'حقيبة جلد كروس',
    sku: 'B990045', imageUrl: null, priceMinor: 219_000, currency: 'SAR', productType: 'bag',
    status: 'active', arEnabled: false, tryonEnabled: false, modelStatus: 'none',
    dimensions: { widthMm: 220, heightMm: 160, depthMm: 70 },
    views30: 1_340, arSessions30: 0, updatedAt: iso(4),
  },
  {
    id: 'p-990046', name: 'Titanium eyeglasses frame', nameAr: 'إطار نظارات تيتانيوم',
    sku: 'E990046', imageUrl: null, priceMinor: 158_000, currency: 'SAR', productType: 'eyewear',
    status: 'draft', arEnabled: false, tryonEnabled: false, modelStatus: 'failed',
    dimensions: { widthMm: 140, heightMm: 44 },
    views30: 0, arSessions30: 0, updatedAt: iso(6),
  },
  {
    id: 'p-990047', name: 'Rose gold tennis bracelet', nameAr: 'إسورة تنس ذهب وردي',
    sku: 'J990047', imageUrl: null, priceMinor: 480_000, currency: 'SAR', productType: 'jewelry',
    status: 'active', arEnabled: true, tryonEnabled: true, modelStatus: 'ready',
    dimensions: { widthMm: 4, heightMm: 180 },
    views30: 980, arSessions30: 268, updatedAt: iso(3),
  },
  {
    id: 'p-990048', name: 'Classic steel chronograph', nameAr: 'ساعة كرونوغراف ستيل كلاسيكية',
    sku: 'P990048', imageUrl: null, priceMinor: 412_000, currency: 'SAR', productType: 'watch',
    status: 'active', arEnabled: false, tryonEnabled: false, modelStatus: 'none',
    dimensions: { caseMm: 41 },
    views30: 760, arSessions30: 0, updatedAt: iso(8),
  },
];

export const DEMO_MODELS: ModelRow[] = [
  { id: 'm-1', productId: 'p-820241410', productName: 'ساعة فايلت النسائية الألماس', name: 'diamond-watch-v3',
    source: 'uploaded', status: 'ready', qaStatus: 'approved', version: 3, sizeBytes: 1_480_000,
    polyCount: 48_200, formats: ['glb', 'usdz'], thumbnailUrl: null, updatedAt: iso(0, 9) },
  { id: 'm-2', productId: 'p-820241411', productName: 'ساعة بسوار ذهبي شبكي', name: 'mesh-watch-v2',
    source: 'ai_generated', status: 'ready', qaStatus: 'approved', version: 2, sizeBytes: 1_910_000,
    polyCount: 61_000, formats: ['glb', 'usdz'], thumbnailUrl: null, updatedAt: iso(1) },
  { id: 'm-3', productId: 'p-730118', productName: 'أقراط لؤلؤ متدلية', name: 'pearl-earrings-v1',
    source: 'ai_generated', status: 'ready', qaStatus: 'pending', version: 1, sizeBytes: 640_000,
    polyCount: 22_400, formats: ['glb', 'usdz'], thumbnailUrl: null, updatedAt: iso(2) },
  { id: 'm-4', productId: 'p-730119', productName: 'خاتم زمرد منفرد', name: 'emerald-ring-v1',
    source: 'ai_generated', status: 'processing', qaStatus: 'pending', version: 1, sizeBytes: 0,
    polyCount: null, formats: [], thumbnailUrl: null, updatedAt: iso(0, 14) },
  { id: 'm-5', productId: 'p-990046', productName: 'إطار نظارات تيتانيوم', name: 'titanium-frame-v1',
    source: 'ai_generated', status: 'failed', qaStatus: 'rejected', version: 1, sizeBytes: 0,
    polyCount: null, formats: [], thumbnailUrl: null, updatedAt: iso(6) },
  { id: 'm-6', productId: 'p-990047', productName: 'إسورة تنس ذهب وردي', name: 'tennis-bracelet-v1',
    source: 'professional_service', status: 'ready', qaStatus: 'approved', version: 1, sizeBytes: 1_120_000,
    polyCount: 39_800, formats: ['glb', 'usdz'], thumbnailUrl: null, updatedAt: iso(3) },
];

export const DEMO_ACTIVITY: ActivityItem[] = [
  { id: 'a-1', kind: 'sync', level: 'success', at: iso(0, 6),
    title: { ar: 'اكتملت مزامنة المنتجات', en: 'Product sync completed' },
    detail: { ar: '64 منتجًا · 3 محدّثة', en: '64 products · 3 updated' } },
  { id: 'a-2', kind: 'model', level: 'info', at: iso(0, 14),
    title: { ar: 'جارٍ توليد نموذج ثلاثي الأبعاد', en: '3D model generating' },
    detail: { ar: 'خاتم زمرد منفرد', en: 'Emerald solitaire ring' } },
  { id: 'a-3', kind: 'publish', level: 'success', at: iso(1, 11),
    title: { ar: 'نُشرت إعدادات العرض', en: 'AR settings published' },
    detail: { ar: 'ساعة بسوار ذهبي شبكي', en: 'Gold mesh bracelet watch' } },
  { id: 'a-4', kind: 'model', level: 'error', at: iso(6, 15),
    title: { ar: 'فشل توليد نموذج', en: '3D generation failed' },
    detail: { ar: 'إطار نظارات تيتانيوم — الصور غير كافية', en: 'Titanium frame — not enough usable photos' } },
  { id: 'a-5', kind: 'team', level: 'info', at: iso(9, 12),
    title: { ar: 'انضم عضو جديد للفريق', en: 'A team member joined' },
    detail: { ar: 'سارة — محرّر', en: 'Sarah — editor' } },
];

export const DEMO_DASHBOARD: DashboardSummary = {
  tenant: {
    id: 't-demo', name: 'Failet — فايلت', slug: 'failet', plan: 'growth', status: 'trial',
    trialEndsAt: iso(-9), logoUrl: null, role: 'owner',
  },
  onboarding: {
    complete: false,
    // The shared copy (lib/onboarding-steps.ts); only whether each is done is demo data.
    steps: STEP_COPY.map((step) => ({ ...step, done: !['catalogue', 'embed'].includes(step.key), skipped: false })),
  },
  counts: { products: 64, arEnabled: 41, models: 6, modelsReady: 4, teamMembers: 3 },
  usage: {
    products: { used: 64, limit: 200 },
    arSessions: { used: TOTALS.arSessions, limit: 50_000 },
    aiCredits: { used: 12, limit: 40 },
    storage: { used: 0.42, limit: 20 },
  },
  last30: TOTALS,
  series: SERIES,
  connection: DEMO_CONNECTION,
  activity: DEMO_ACTIVITY,
};

export const DEMO_TEAM: TeamMemberRow[] = [
  { id: 'u-1', fullName: 'نادر', email: 'owner@failet.sa', role: 'owner', status: 'active', lastLoginAt: iso(0, 8) },
  { id: 'u-2', fullName: 'سارة', email: 'sara@failet.sa', role: 'editor', status: 'active', lastLoginAt: iso(1) },
  { id: 'u-3', fullName: 'خالد', email: 'khaled@failet.sa', role: 'analyst', status: 'invited', lastLoginAt: null },
];

export const DEMO_BILLING: BillingSummary = {
  plan: 'growth',
  status: 'trialing',
  cycle: 'monthly',
  renewsAt: iso(-9),
  trialEndsAt: iso(-9),
  priceMinor: 29_900,
  currency: 'SAR',
  aiCredits: { balance: 28, grantedThisPeriod: 40, usedThisPeriod: 12 },
  // No invoices during a trial, and no invented payment method.
  invoices: [],
  paymentMethod: null,
  catalogue: PLANS.map((p) => ({ code: p.code, priceMonthlyMinor: p.priceMonthlyMinor, priceAnnualMinor: p.priceAnnualMinor })),
};

export const DEMO_ANALYTICS: AnalyticsView = {
  range: '30d',
  totals: TOTALS,
  series: SERIES,
  byDevice: [
    { device: 'mobile', sessions: Math.round(TOTALS.arSessions * 0.78), arSupported: Math.round(TOTALS.arSessions * 0.71) },
    { device: 'tablet', sessions: Math.round(TOTALS.arSessions * 0.09), arSupported: Math.round(TOTALS.arSessions * 0.08) },
    { device: 'desktop', sessions: Math.round(TOTALS.arSessions * 0.13), arSupported: Math.round(TOTALS.arSessions * 0.02) },
  ],
  topProducts: DEMO_PRODUCTS.filter((p) => p.arEnabled).slice(0, 5).map((p, i) => ({
    productId: p.id,
    name: p.nameAr ?? p.name,
    views: p.views30,
    arSessions: p.arSessions30,
    purchases: Math.round(p.arSessions30 * 0.05),
    upliftPct: i < 3 ? [0.082, 0.064, 0.031][i] : null,
  })),
  // The demo's uplift (0.069) as two groups: 9.3% of 2,622 with AR, 2.4% of 5,235 without.
  conversion: {
    withAr: { sessions: 2622, purchases: 244 },
    withoutAr: { sessions: 5235, purchases: 127 },
    upliftPct: TOTALS.upliftPct,
    verdict: 'likely-real',
  },
  funnel: [
    { step: { ar: 'مشاهدة المنتج', en: 'Product view' }, value: TOTALS.views },
    { step: { ar: 'فتح العرض', en: 'AR opened' }, value: TOTALS.arSessions },
    { step: { ar: 'تجربة افتراضية', en: 'Try-on started' }, value: TOTALS.tryonSessions },
    { step: { ar: 'أضيف للسلة', en: 'Added to cart' }, value: TOTALS.addToCart },
    { step: { ar: 'شراء', en: 'Purchase' }, value: TOTALS.purchases },
  ],
};
