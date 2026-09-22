import type { Bi } from './lang';

/**
 * Company details shown in the footer, contact page and legal pages.
 *
 * TODO before launch — replace every placeholder below with the registered
 * details. Empty strings are simply not rendered, so nothing invented appears
 * on the site; the two email addresses are placeholders on a domain that must
 * be registered and have working mailboxes before they are published.
 */
export const COMPANY = {
  name: { ar: 'تجربة', en: 'Tajribah' } as Bi,
  legalName: { ar: '', en: '' } as Bi,
  crNumber: '',
  vatNumber: '',
  address: { ar: '', en: '' } as Bi,
  email: 'hello@tajribah.sa',
  privacyEmail: 'privacy@tajribah.sa',
  /** Where the storefront script is served from once the CDN is live. */
  cdnHost: 'cdn.tajribah.sa',
  legalUpdated: { ar: '22 سبتمبر 2026', en: '22 September 2026' } as Bi,
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
      { href: '/pricing', label: { ar: 'الأسعار', en: 'Pricing' } },
    ],
  },
  {
    title: { ar: 'الشركة', en: 'Company' },
    links: [
      { href: '/about', label: { ar: 'من نحن', en: 'About' } },
      { href: '/faq', label: { ar: 'الأسئلة الشائعة', en: 'FAQ' } },
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
  '/privacy': { ar: 'سياسة الخصوصية', en: 'Privacy policy' },
  '/try-on-privacy': { ar: 'خصوصية الكاميرا والصور', en: 'Camera & photo privacy' },
  '/terms': { ar: 'الشروط والأحكام', en: 'Terms of service' },
  '/refund': { ar: 'سياسة الإلغاء والاسترداد', en: 'Cancellation & refund policy' },
  '/cookies': { ar: 'سياسة ملفات تعريف الارتباط', en: 'Cookie policy' },
};
