import type { Bi } from '@/lib/lang';

/**
 * T68 — the partner and reseller terms (Nader delegated the choice, 2026-10-03). Drafts: they await
 * review by Saudi-licensed counsel, like the legal pages, and the page says so. Commission tracking
 * arrives with card payments; until then applications are by email and payouts are reconciled by hand.
 */
export const REFERRAL_RATE = 20; // % of the referred store's subscription payments
export const REFERRAL_MONTHS = 12; // for the store's first 12 months
export const AGENCY_DISCOUNT = 20; // % off plan prices
export const AGENCY_MIN_STORES = 5;
export const PAYOUT_AFTER_DAYS = 30;

export type Program = { key: 'referral' | 'agency'; title: Bi; who: Bi; terms: Bi[] };

export const PROGRAMS: Program[] = [
  {
    key: 'referral',
    title: { ar: 'شريك إحالة', en: 'Referral partner' },
    who: { ar: 'للمسوّقين والمستشارين ومطوري المتاجر الذين يعرّفون التجار بتجربة.', en: 'For marketers, consultants and store builders who introduce merchants to Tajribah.' },
    terms: [
      { ar: `${REFERRAL_RATE}% من مدفوعات اشتراك كل متجر تحيله، طوال أول ${REFERRAL_MONTHS} شهرًا من اشتراكه.`, en: `${REFERRAL_RATE}% of each referred store’s subscription payments, for its first ${REFERRAL_MONTHS} months.` },
      { ar: `تُدفع شهريًا بالريال السعودي بتحويل بنكي، بعد مرور ${PAYOUT_AFTER_DAYS} يومًا على دفعة المتجر.`, en: `Paid monthly in Saudi riyals by bank transfer, once the store’s payment is ${PAYOUT_AFTER_DAYS} days old.` },
      { ar: 'تُحتسب الإحالة حين يشترك المتجر عبر رابطك أو يذكرك عند الاشتراك.', en: 'A referral counts when the store signs up through your link or names you when it subscribes.' },
      { ar: 'لا عمولة على الضريبة، ولا على المبالغ المستردة.', en: 'No commission on VAT, or on amounts refunded.' },
    ],
  },
  {
    key: 'agency',
    title: { ar: 'وكالة أو موزّع', en: 'Agency or reseller' },
    who: { ar: `للوكالات التي تدير ${AGENCY_MIN_STORES} متاجر أو أكثر لعملائها.`, en: `For agencies managing ${AGENCY_MIN_STORES} or more stores for their clients.` },
    terms: [
      { ar: `خصم ${AGENCY_DISCOUNT}% على أسعار الباقات لكل متجر تديره، وتصدر الفاتورة باسم الوكالة.`, en: `${AGENCY_DISCOUNT}% off plan prices for each store you manage, invoiced to the agency.` },
      { ar: 'كل متاجرك في حساب واحد مع صفحة «كل متاجرك»، وصلاحيات فريقك في كل متجر.', en: 'All your stores under one sign-in with the “All your stores” page, and your team’s roles in each store.' },
      { ar: 'تحدد سعرك لعميلك بنفسك؛ لا نتواصل مع عملائك بخصوص الأسعار.', en: 'You set your own price to your client; we do not contact your clients about pricing.' },
    ],
  },
];

export const DRAFT_NOTE: Bi = {
  ar: 'هذه الشروط مسودة بانتظار مراجعة محامٍ مرخّص في السعودية، وقد تتغير قبل اعتمادها. الاتفاقية الموقّعة هي المرجع.',
  en: 'These terms are a draft awaiting review by Saudi-licensed counsel and may change before they are final. The signed agreement governs.',
};
