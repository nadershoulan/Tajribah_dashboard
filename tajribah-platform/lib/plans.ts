/**
 * The plan catalogue (§2 of the build plan). Prices are monthly, in halalas, VAT added at
 * checkout — §11 requires VAT to be shown separately, never folded into a headline price.
 *
 * This is the seed for the `plans` table and the source for the pricing page, so the two
 * can never disagree.
 */
import type { Bi } from './lang';

export type PlanCode = 'starter' | 'growth' | 'pro' | 'enterprise';

export type PlanLimits = {
  products: number;
  ai_credits: number;
  storage_gb: number;
  ar_sessions: number;
  team_members: number;
  bandwidth_gb: number;
};

export type PlanDefinition = {
  code: PlanCode;
  name: Bi;
  tagline: Bi;
  /** Halalas per month. `null` means "talk to us" — never a made-up number. */
  priceMonthlyMinor: number | null;
  /** Two months free, the usual SaaS shape. Null for enterprise. */
  priceAnnualMinor: number | null;
  featured?: boolean;
  limits: PlanLimits;
  features: string[];
  highlights: Bi[];
};

/** `-1` is unlimited, the same convention as `plan_limits.value` (§7.4). */
export const UNLIMITED = -1;

export const PLANS: PlanDefinition[] = [
  {
    code: 'starter',
    name: { ar: 'البداية', en: 'Starter' }, // T32: the website's name, one name everywhere
    tagline: { ar: 'لمتجر يجرّب العرض ثلاثي الأبعاد لأول مرة', en: 'For a store trying 3D for the first time' },
    priceMonthlyMinor: 9900,
    priceAnnualMinor: 99000,
    limits: { products: 20, ai_credits: 5, storage_gb: 2, ar_sessions: 5_000, team_members: 2, bandwidth_gb: 50 },
    // T33: the try-on studio (on the model, true-size comparison) on every plan, as the website says.
    features: ['ar_viewer', 'hosted_pages', 'qr_codes', 'size_comparison', 'basic_analytics'],
    highlights: [
      { ar: '20 منتجًا بعرض ثلاثي الأبعاد', en: '20 products with 3D viewing' },
      { ar: 'زر «شاهدها في مكانك» داخل متجرك', en: '“View in your space” button in your store' },
      { ar: 'صفحات وروابط QR لكل منتج', en: 'Hosted pages and QR codes per product' },
    ],
  },
  {
    code: 'growth',
    name: { ar: 'النمو', en: 'Growth' },
    tagline: { ar: 'لمتجر يبيع ويحتاج أرقامًا يبني عليها', en: 'For a store that sells and needs numbers to act on' },
    priceMonthlyMinor: 29900,
    priceAnnualMinor: 299000,
    featured: true,
    limits: { products: 200, ai_credits: 40, storage_gb: 20, ar_sessions: 50_000, team_members: 5, bandwidth_gb: 500 },
    features: ['ar_viewer', 'hosted_pages', 'qr_codes', 'size_comparison', 'full_analytics', 'salla', 'zid'],
    highlights: [
      { ar: '200 منتج، ومقارنة الحجم بأشياء يعرفها العميل', en: '200 products, plus size comparison with familiar objects' },
      { ar: 'ربط مباشر مع سلة وزد', en: 'Direct Salla and Zid integration' },
      { ar: 'تقارير التحويل ومعدل الإرجاع', en: 'Conversion and return-rate reporting' },
    ],
  },
  {
    code: 'pro',
    name: { ar: 'الاحترافية', en: 'Pro' },
    tagline: { ar: 'لمتجر التجربة الافتراضية جزء أساسي من بيعه', en: 'For a store where virtual try-on is core to the sale' },
    priceMonthlyMinor: 99900,
    priceAnnualMinor: 999000,
    limits: { products: UNLIMITED, ai_credits: 200, storage_gb: 100, ar_sessions: 250_000, team_members: 15, bandwidth_gb: 2_000 },
    features: [
      'ar_viewer', 'hosted_pages', 'qr_codes', 'size_comparison', 'full_analytics',
      'salla', 'zid', 'shopify', 'woocommerce', 'virtual_tryon', 'ai_3d', 'recommendations',
    ],
    highlights: [
      { ar: 'منتجات بلا حد، وتجربة افتراضية كاملة', en: 'Unlimited products and full virtual try-on' },
      { ar: 'توليد نماذج ثلاثية الأبعاد من صور المنتج', en: '3D models generated from product photos' },
      { ar: 'توصيات ومقارنات مدعومة بالذكاء الاصطناعي', en: 'AI recommendations and comparisons' },
    ],
  },
  {
    code: 'enterprise',
    name: { ar: 'المؤسسات', en: 'Enterprise' },
    tagline: { ar: 'علامة تجارية كاملة، واجهة برمجية، ودعم مخصص', en: 'White label, API access and dedicated support' },
    priceMonthlyMinor: null,
    priceAnnualMinor: null,
    limits: {
      products: UNLIMITED, ai_credits: UNLIMITED, storage_gb: UNLIMITED,
      ar_sessions: UNLIMITED, team_members: UNLIMITED, bandwidth_gb: UNLIMITED,
    },
    features: [
      'ar_viewer', 'hosted_pages', 'qr_codes', 'size_comparison', 'full_analytics',
      'salla', 'zid', 'shopify', 'woocommerce', 'virtual_tryon', 'ai_3d', 'recommendations',
      'white_label', 'public_api', 'sso', 'custom_roles', 'custom_domain', 'dedicated_support',
    ],
    highlights: [
      { ar: 'هوية بصرية كاملة ونطاق خاص', en: 'Full white label and a custom domain' },
      { ar: 'واجهة برمجية عامة وتسجيل دخول موحّد', en: 'Public API and SSO' },
      { ar: 'اتفاقية مستوى خدمة ودعم مخصص', en: 'An SLA and a dedicated contact' },
    ],
  },
];

export const planByCode = (code: PlanCode): PlanDefinition =>
  PLANS.find((p) => p.code === code)!;

export const FEATURE_LABELS: Record<string, Bi> = {
  ar_viewer: { ar: 'عارض ثلاثي الأبعاد و AR', en: '3D and AR viewer' },
  hosted_pages: { ar: 'صفحات استضافة للمنتج', en: 'Hosted product pages' },
  qr_codes: { ar: 'رموز QR', en: 'QR codes' },
  size_comparison: { ar: 'مقارنة الحجم الحقيقي', en: 'True-size comparison' },
  basic_analytics: { ar: 'إحصاءات أساسية', en: 'Basic analytics' },
  full_analytics: { ar: 'تحليلات كاملة وتقارير التحويل', en: 'Full analytics and conversion reporting' },
  salla: { ar: 'تكامل سلة', en: 'Salla integration' },
  zid: { ar: 'تكامل زد', en: 'Zid integration' },
  shopify: { ar: 'تكامل Shopify', en: 'Shopify integration' },
  woocommerce: { ar: 'تكامل WooCommerce', en: 'WooCommerce integration' },
  // T33: the studio itself is on every plan; this is trying the watch on the shopper's own photo.
  virtual_tryon: { ar: 'التجربة الافتراضية بالذكاء الاصطناعي', en: 'AI virtual try-on' },
  ai_3d: { ar: 'توليد النماذج بالذكاء الاصطناعي', en: 'AI 3D generation' },
  recommendations: { ar: 'توصيات المنتجات', en: 'Product recommendations' },
  white_label: { ar: 'علامة بيضاء', en: 'White label' },
  public_api: { ar: 'واجهة برمجية عامة', en: 'Public API' },
  sso: { ar: 'تسجيل دخول موحّد', en: 'SSO' },
  custom_roles: { ar: 'أدوار مخصصة', en: 'Custom roles' },
  custom_domain: { ar: 'نطاق مخصص', en: 'Custom domain' },
  dedicated_support: { ar: 'دعم مخصص', en: 'Dedicated support' },
};

export const LIMIT_LABELS: Record<keyof PlanLimits, Bi> = {
  products: { ar: 'المنتجات', en: 'Products' },
  ai_credits: { ar: 'أرصدة الذكاء الاصطناعي شهريًا', en: 'AI credits per month' },
  storage_gb: { ar: 'مساحة التخزين', en: 'Storage' },
  ar_sessions: { ar: 'جلسات AR شهريًا', en: 'AR sessions per month' },
  team_members: { ar: 'أعضاء الفريق', en: 'Team members' },
  bandwidth_gb: { ar: 'نقل البيانات شهريًا', en: 'Bandwidth per month' },
};

/** Trial length for a new store, in days. */
export const TRIAL_DAYS = 14;
