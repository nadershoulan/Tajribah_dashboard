/**
 * P1.22 — how each onboarding step is shown on the home screen: title, one line, where it
 * leads, and an honest time estimate. One copy for the API (server/modules/dashboard) and the
 * preview's demo data, so the two cannot say different things. Which steps are *done* is
 * decided by the database (server/modules/onboarding/machine.ts), never here.
 *
 * `plan` is not listed: choosing a plan happens in billing, and the trial runs without it.
 */
import type { OnboardingStep } from './view-models';

export const STEP_COPY: Omit<OnboardingStep, 'done' | 'skipped'>[] = [
  { key: 'account', title: { ar: 'إنشاء الحساب', en: 'Create your account' },
    description: { ar: 'تم', en: 'Done' }, href: '/dashboard', minutes: 2 },
  { key: 'store', title: { ar: 'بيانات المتجر', en: 'Store details' },
    description: { ar: 'الاسم والسجل التجاري والرقم الضريبي', en: 'Name, CR and VAT number' },
    // Confirming the store happens only in the setup guide (P1.2), not in settings.
    href: '/dashboard/onboarding', minutes: 3 },
  { key: 'connect', title: { ar: 'أضف منتجاتك', en: 'Add your products' },
    description: { ar: 'من رابط ملف المنتجات أو ملف', en: 'From a product feed link or a file' },
    href: '/dashboard/connections', minutes: 2 },
  { key: 'catalogue', title: { ar: 'مراجعة المقاسات', en: 'Check your dimensions' },
    description: { ar: 'المقاس بالمليمتر هو ما يجعل الحجم حقيقيًا', en: 'Millimetres are what make the size real' },
    href: '/dashboard/products', minutes: 10 },
  // T90: 3D models are version 2 — the first try-on is the step (the step's key stays; the machine already counts a ready try-on)
  { key: 'first_model', title: { ar: 'جهّز تجربة أول منتج', en: 'Set up your first try-on' },
    description: { ar: 'صورته بلا خلفية (بنقرة من معاينته) ومقاسه', en: 'Its picture without a background (one click from its preview) and its size' },
    href: '/dashboard/tryon', minutes: 3 },
  { key: 'publish', title: { ar: 'النشر في متجرك', en: 'Publish to your store' },
    description: { ar: 'اضغط «انشر في المتجر» في إعدادات تجربة المنتج', en: 'Press “Publish to the store” in the product’s try-on settings' },
    href: '/dashboard/tryon', minutes: 1 },
  { key: 'embed', title: { ar: 'تركيب الزر في متجرك', en: 'Install the button in your store' },
    description: { ar: 'في سلة: وسم واحد في Google Tag Manager — أو سطران في قالب صفحة المنتج', en: 'On Salla: one tag in Google Tag Manager — or two lines in your product page template' },
    href: '/dashboard/embed', minutes: 5 },
];

/**
 * P1.2 — `plan` as the setup guide shows it. The trial runs without a plan, so the guide
 * offers to carry on with the trial (a skip) and points at billing for the rest.
 */
export const PLAN_STEP_COPY = {
  key: 'plan' as const,
  title: { ar: 'الباقة', en: 'Your plan' },
  description: { ar: 'تجربتك المجانية تعمل الآن — تختار الباقة لاحقًا', en: 'Your free trial is running — choose a plan later' },
  href: '/dashboard/billing',
  minutes: 1,
};
