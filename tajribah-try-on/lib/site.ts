import type { Bi } from './lang';

/**
 * Company details shown in the footer, contact page and legal pages.
 *
 * Supplied by the owner (2026-09-27): SRO Company operates Tajribah — Ministry of
 * Commerce CR / unified number 7033242079, ZATCA VAT registration 314550511700003
 * (effective 2026-02-01), National Address RRMA7169 (building 7169, Prince
 * Muhammad Ibn Saad Ibn Abdulaziz Rd, Al Malqa, Riyadh 13524, secondary 2369).
 * The same facts the platform's invoices carry (tajribah-platform
 * server/core/billing/seller.ts).
 *
 * Contact, supplied by the owner (2026-10-04): info@tajribah.org (also for privacy requests, until a
 * separate mailbox exists) and the mobile 055 370 0329.
 */
export const COMPANY = {
  name: { ar: 'تجربة', en: 'Tajribah' } as Bi,
  legalName: { ar: 'شركة إس أر أو', en: 'SRO Company' } as Bi,
  crNumber: '7033242079',
  vatNumber: '314550511700003',
  address: { ar: 'حي الملقا، الرياض 13524، المملكة العربية السعودية', en: 'Al Malqa, Riyadh 13524, Saudi Arabia' } as Bi,
  email: 'info@tajribah.org',
  privacyEmail: 'info@tajribah.org',
  /** As people in Saudi Arabia write it; `tel` is the dialable form. */
  phone: '055 370 0329',
  tel: '+966553700329',
  /**
   * The site's public address, for the sitemap, robots and absolute links. The domain is not
   * confirmed yet: set NEXT_PUBLIC_SITE_URL at deploy; the default is a guess until then.
   */
  // `typeof` guard: the static preview's browser bundle has no `process`.
  siteUrl: ((typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SITE_URL) || 'https://tajribah.sa').replace(/\/$/, ''),
  /**
   * The merchant dashboard — sign-up and sign-in (T32: app.tajribah.sa). Override with
   * NEXT_PUBLIC_APP_URL at deploy, like the site's own address.
   */
  appUrl: ((typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_URL) || 'https://app.tajribah.sa').replace(/\/$/, ''),
  /**
   * The storefront script, exactly as the dashboard's install page gives it (`widget/src/main.ts`
   * WIDGET_SRC in tajribah-platform — its test checks this line). Services stay on tajribah.com (T29).
   */
  widgetSrc: 'https://cdn.tajribah.com/w/v1/widget.js',
  legalUpdated: { ar: '3 أكتوبر 2026', en: '3 October 2026' } as Bi,
};

export type NavItem = { href: string; label: Bi };

export const NAV: NavItem[] = [
  { href: '/features', label: { ar: 'المزايا', en: 'Features' } },
  { href: '/how-it-works', label: { ar: 'كيف تعمل', en: 'How it works' } },
  { href: '/integrations', label: { ar: 'التكاملات', en: 'Integrations' } },
  { href: '/pricing', label: { ar: 'الأسعار', en: 'Pricing' } },
  { href: '/about', label: { ar: 'من نحن', en: 'About' } },
];

export const FOOTER: { title: Bi; links: NavItem[] }[] = [
  {
    title: { ar: 'المنتج', en: 'Product' },
    links: [
      { href: '/demo', label: { ar: 'العرض التجريبي', en: 'Live demo' } },
      { href: '/features', label: { ar: 'المزايا', en: 'Features' } },
      { href: '/how-it-works', label: { ar: 'كيف تعمل', en: 'How it works' } },
      { href: '/integrations', label: { ar: 'التكاملات', en: 'Integrations' } },
      { href: '/industries', label: { ar: 'حسب ما تبيعه', en: 'By what you sell' } },
      { href: '/salla', label: { ar: 'لمتاجر سلة', en: 'For Salla stores' } },
      { href: '/zid', label: { ar: 'لمتاجر زد', en: 'For Zid stores' } },
      { href: '/pricing', label: { ar: 'الأسعار', en: 'Pricing' } },
    ],
  },
  {
    title: { ar: 'المصادر', en: 'Resources' },
    links: [
      { href: '/help', label: { ar: 'مركز المساعدة', en: 'Help centre' } },
      { href: '/blog', label: { ar: 'المدونة', en: 'Blog' } },
      { href: '/customers', label: { ar: 'قصص الاستخدام', en: 'Customer stories' } },
      { href: '/developers', label: { ar: 'للمطوّرين', en: 'Developers' } },
    ],
  },
  {
    title: { ar: 'الشركة', en: 'Company' },
    links: [
      { href: '/about', label: { ar: 'من نحن', en: 'About' } },
      { href: '/faq', label: { ar: 'الأسئلة الشائعة', en: 'FAQ' } },
      { href: '/careers', label: { ar: 'الوظائف', en: 'Careers' } },
      { href: '/partners', label: { ar: 'الشركاء', en: 'Partners' } },
      { href: '/contact', label: { ar: 'تواصل معنا', en: 'Contact' } },
    ],
  },
  {
    title: { ar: 'السياسات', en: 'Policies' },
    links: [
      { href: '/privacy', label: { ar: 'سياسة الخصوصية', en: 'Privacy policy' } },
      { href: '/try-on-privacy', label: { ar: 'خصوصية الكاميرا والصور', en: 'Camera & photo privacy' } },
      { href: '/terms', label: { ar: 'الشروط والأحكام', en: 'Terms of service' } },
      { href: '/refund', label: { ar: 'الإلغاء والاسترداد', en: 'Cancellation & refunds' } },
      { href: '/cookies', label: { ar: 'ملفات تعريف الارتباط', en: 'Cookie policy' } },
    ],
  },
];

/** Page titles, shared by Next metadata and the preview's document.title. */
export const TITLES: Record<string, Bi> = {
  '/': { ar: 'تجربة — جرّبها قبل أن تشتريها', en: 'Tajribah — try it before you buy it' },
  '/demo': { ar: 'العرض التجريبي', en: 'Live demo' },
  '/features': { ar: 'المزايا', en: 'Features' },
  '/how-it-works': { ar: 'كيف تعمل', en: 'How it works' },
  '/integrations': { ar: 'التكاملات', en: 'Integrations' },
  '/pricing': { ar: 'الأسعار', en: 'Pricing' },
  '/about': { ar: 'من نحن', en: 'About' },
  '/contact': { ar: 'تواصل معنا', en: 'Contact' },
  '/faq': { ar: 'الأسئلة الشائعة', en: 'FAQ' },
  '/developers': { ar: 'للمطوّرين — الواجهة البرمجية والإشعارات البرمجية', en: 'For developers — the API and webhooks' },
  '/privacy': { ar: 'سياسة الخصوصية', en: 'Privacy policy' },
  '/try-on-privacy': { ar: 'خصوصية الكاميرا والصور', en: 'Camera & photo privacy' },
  '/terms': { ar: 'الشروط والأحكام', en: 'Terms of service' },
  '/refund': { ar: 'سياسة الإلغاء والاسترداد', en: 'Cancellation & refund policy' },
  '/cookies': { ar: 'سياسة ملفات تعريف الارتباط', en: 'Cookie policy' },
  '/salla': { ar: 'التجربة الافتراضية لمتاجر سلة', en: 'Virtual try-on for Salla stores' },
  '/zid': { ar: 'التجربة الافتراضية لمتاجر زد', en: 'Virtual try-on for Zid stores' },
  '/help': { ar: 'مركز المساعدة', en: 'Help centre' },
  '/blog': { ar: 'المدونة', en: 'Blog' },
  '/customers': { ar: 'قصص الاستخدام', en: 'Customer stories' },
  '/careers': { ar: 'الوظائف', en: 'Careers' },
  '/partners': { ar: 'برنامج الشركاء', en: 'Partner programme' },
  // M5 — a page per way to try; the titles come from content/features.ts.
  '/features/on-model': { ar: 'العرض على العارضة', en: 'On model' },
  '/features/on-me': { ar: 'التجربة على صورتك', en: 'On your own photo' },
  '/features/true-size': { ar: 'المقارنة بالحجم الحقيقي', en: 'True-size comparison' },
  '/industries': { ar: 'حسب ما تبيعه', en: 'By what you sell' },
  '/industries/watches': { ar: 'لمتاجر الساعات', en: 'For watch stores' },
  '/industries/jewellery': { ar: 'لمتاجر المجوهرات', en: 'For jewellery stores' },
  '/industries/eyewear': { ar: 'لمتاجر النظارات', en: 'For eyewear stores' },
  '/industries/bags': { ar: 'لمتاجر الحقائب', en: 'For bag stores' },
  '/features/phone-handoff': { ar: 'من الحاسوب إلى الجوال', en: 'Desktop to phone' },
};
