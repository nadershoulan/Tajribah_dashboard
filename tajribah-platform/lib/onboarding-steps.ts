/**
 * P1.22 — how each onboarding step is shown on the home screen: title, one line, where it
 * leads, and an honest time estimate. One copy for the API (server/modules/dashboard) and the
 * preview's demo data, so the two cannot say different things. Which steps are *done* is
 * decided by the database (server/modules/onboarding/machine.ts), never here.
 *
 * `plan` is not listed: choosing a plan happens in billing, and the trial runs without it.
 */
import type { OnboardingStep } from './view-models';

export const STEP_COPY: Omit<OnboardingStep, 'done'>[] = [
  { key: 'account', title: { ar: 'إنشاء الحساب', en: 'Create your account' },
    description: { ar: 'تم', en: 'Done' }, href: '/dashboard', minutes: 2 },
  { key: 'store', title: { ar: 'بيانات المتجر', en: 'Store details' },
    description: { ar: 'الاسم والسجل التجاري والرقم الضريبي', en: 'Name, CR and VAT number' },
    href: '/dashboard/settings', minutes: 3 },
  { key: 'connect', title: { ar: 'ربط سلة', en: 'Connect Salla' },
    description: { ar: 'نستورد منتجاتك تلقائيًا', en: 'We import your catalogue automatically' },
    href: '/dashboard/connections', minutes: 2 },
  { key: 'catalogue', title: { ar: 'مراجعة المقاسات', en: 'Check your dimensions' },
    description: { ar: 'المقاس بالمليمتر هو ما يجعل الحجم حقيقيًا', en: 'Millimetres are what make the size real' },
    href: '/dashboard/products', minutes: 10 },
  { key: 'first_model', title: { ar: 'أول نموذج ثلاثي الأبعاد', en: 'Your first 3D model' },
    description: { ar: 'ارفع ملف GLB أو USDZ للمنتج', en: 'Upload a GLB or USDZ file for a product' },
    href: '/dashboard/models', minutes: 5 },
  { key: 'embed', title: { ar: 'تركيب الزر في متجرك', en: 'Install the button in your store' },
    description: { ar: 'سطر واحد في قالب صفحة المنتج', en: 'One line in your product page template' },
    href: '/dashboard/embed', minutes: 5 },
];
