import type { Bi } from './lang';

/**
 * Plans and prices from the Tajribah build plan (§2). SAR, VAT added at checkout.
 *
 * `priceAnnual` is ten months' price for twelve — the same figures the dashboard's plan
 * catalogue charges (`tajribah-platform/lib/plans.ts`). Keep the two in step: the annual
 * price shown here is what checkout takes.
 */
export type Plan = {
  id: 'starter' | 'growth' | 'pro' | 'enterprise';
  name: Bi;
  /** Per month, SAR. `null` = pricing on request. */
  price: number | null;
  /** Per year, SAR: ten months for twelve. `null` = pricing on request. */
  priceAnnual: number | null;
  blurb: Bi;
  products: Bi;
  features: Bi[];
  featured?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: { ar: 'البداية', en: 'Starter' },
    price: 99,
    priceAnnual: 990,
    blurb: { ar: 'لمتجر يريد أن يبدأ بأكثر منتجاته مبيعًا.', en: 'For a store starting with its best sellers.' },
    products: { ar: 'حتى 20 منتجًا', en: 'Up to 20 products' },
    features: [
      { ar: 'زر «جرّبها» في صفحة المنتج', en: '“Try it” button on the product page' },
      { ar: 'المقارنة بالحجم الحقيقي', en: 'True-size comparison' },
      { ar: 'العرض ثلاثي الأبعاد والواقع المعزز الأساسي', en: 'Basic 3D and AR viewing' },
      { ar: 'واجهة عربية وإنجليزية', en: 'Arabic and English interface' },
      { ar: 'دعم عبر البريد الإلكتروني', en: 'Email support' },
    ],
  },
  {
    id: 'growth',
    name: { ar: 'النمو', en: 'Growth' },
    price: 299,
    priceAnnual: 2990,
    featured: true,
    blurb: { ar: 'لمتجر يريد التجربة على معظم كتالوجه.', en: 'For a store bringing most of its catalogue on board.' },
    products: { ar: 'حتى 200 منتج', en: 'Up to 200 products' },
    features: [
      { ar: 'كل ما في باقة البداية', en: 'Everything in Starter' },
      { ar: 'المقارنة الذكية بين المنتجات', en: 'AI product comparison' },
      { ar: 'مزامنة الكتالوج من منصة متجرك', en: 'Catalogue sync from your store platform' },
      { ar: 'تحليلات كاملة وتقارير التحويل', en: 'Full analytics and conversion reporting' },
    ],
  },
  {
    id: 'pro',
    name: { ar: 'الاحترافية', en: 'Pro' },
    price: 999,
    priceAnnual: 9990,
    blurb: { ar: 'لمتجر يبني تجربة الشراء حول التجربة الافتراضية.', en: 'For a store building its buying experience around try-on.' },
    products: { ar: 'منتجات غير محدودة', en: 'Unlimited products' },
    features: [
      { ar: 'كل ما في باقة النمو', en: 'Everything in Growth' },
      { ar: 'التجربة الافتراضية بالذكاء الاصطناعي', en: 'AI virtual try-on' },
      { ar: 'أولوية في الدعم', en: 'Priority support' },
    ],
  },
  {
    id: 'enterprise',
    name: { ar: 'المؤسسات', en: 'Enterprise' },
    price: null,
    priceAnnual: null,
    blurb: { ar: 'للعلامات الكبيرة والمجموعات متعددة المتاجر.', en: 'For large brands and multi-store groups.' },
    products: { ar: 'حسب الاتفاق', en: 'By agreement' },
    features: [
      { ar: 'علامة بيضاء باسم علامتك', en: 'White label under your brand' },
      { ar: 'واجهة برمجة التطبيقات (API)', en: 'API access' },
      { ar: 'تسجيل دخول موحّد (SSO)', en: 'Single sign-on (SSO)' },
      { ar: 'مدير حساب ودعم مخصص', en: 'Dedicated account manager and support' },
    ],
  },
];

/** The feature-by-plan matrix on the pricing page. true / false / text. */
export const MATRIX: { label: Bi; cells: (boolean | Bi)[] }[] = [
  { label: { ar: 'عدد المنتجات', en: 'Products' }, cells: [{ ar: '20', en: '20' }, { ar: '200', en: '200' }, { ar: 'غير محدود', en: 'Unlimited' }, { ar: 'حسب الاتفاق', en: 'Custom' }] },
  { label: { ar: 'المقارنة بالحجم الحقيقي', en: 'True-size comparison' }, cells: [true, true, true, true] },
  { label: { ar: 'العرض على العارضة', en: 'On-model view' }, cells: [true, true, true, true] },
  { label: { ar: 'العرض ثلاثي الأبعاد والواقع المعزز', en: '3D and AR viewing' }, cells: [{ ar: 'أساسي', en: 'Basic' }, { ar: 'أساسي', en: 'Basic' }, { ar: 'كامل', en: 'Full' }, { ar: 'كامل', en: 'Full' }] },
  { label: { ar: 'المقارنة الذكية بين المنتجات', en: 'AI product comparison' }, cells: [false, true, true, true] },
  { label: { ar: 'التجربة الافتراضية بالذكاء الاصطناعي', en: 'AI virtual try-on' }, cells: [false, false, true, true] },
  { label: { ar: 'مزامنة الكتالوج', en: 'Catalogue sync' }, cells: [false, true, true, true] },
  { label: { ar: 'لوحة التحليلات', en: 'Analytics dashboard' }, cells: [{ ar: 'أساسية', en: 'Basic' }, { ar: 'كاملة', en: 'Full' }, { ar: 'كاملة', en: 'Full' }, { ar: 'كاملة', en: 'Full' }] },
  { label: { ar: 'علامة بيضاء', en: 'White label' }, cells: [false, false, false, true] },
  { label: { ar: 'واجهة برمجة التطبيقات', en: 'API access' }, cells: [false, false, false, true] },
  { label: { ar: 'الدعم', en: 'Support' }, cells: [{ ar: 'بريد', en: 'Email' }, { ar: 'بريد', en: 'Email' }, { ar: 'أولوية', en: 'Priority' }, { ar: 'مخصص', en: 'Dedicated' }] },
];

/** How many months an annual subscription costs — the honest way to state the saving. */
export const ANNUAL_MONTHS = 10;

/** Billing cycle, as the dashboard names it. */
export type Cycle = 'monthly' | 'annual';

/** Grouped ASCII digits in both languages (§11: Arabic copy uses ASCII digits). */
export const num = (n: number) => Math.round(n).toLocaleString('en-US');
