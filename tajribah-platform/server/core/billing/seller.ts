/**
 * P2.6 — the legal seller on every Tajribah invoice.
 *
 * Supplied by Nader: SRO Company operates Tajribah.
 *  - 2026-09-26, Ministry of Commerce certificate (issued 2023-03-20, active, one-person LLC):
 *    the unified national number is the CR number. The Arabic name is as the bank writes it.
 *  - 2026-09-27, ZATCA VAT registration certificate (no. 100261166069860, TIN 3145505117):
 *    VAT number 314550511700003, **registration effective 2026-02-01**, quarterly returns. VAT
 *    may not be charged before that date, so no invoice is issued dated earlier.
 *  - 2026-09-27, National Address proof (no. 1081828547): the address below. The VAT
 *    certificate prints postal code 13525; the National Address record says **13524** with
 *    secondary number 2369 — the National Address is the authority for an address, so 13524.
 *
 * (The IBAN letter's 300002471110003 is Saudi National Bank's VAT number, never SRO's.)
 *
 * In code rather than the environment: these are legal facts that change rarely and should
 * change through review, and every invoice snapshots them at issue, so a later change never
 * rewrites an invoice already sent.
 */
export type NationalAddress = {
  buildingNumber: string;
  street: { ar: string; en: string };
  district: { ar: string; en: string };
  city: { ar: string; en: string };
  postalCode: string;
  secondaryNumber: string;
  shortAddress: string;
};

export type Seller = {
  nameEn: string;
  nameAr: string;
  crNumber: string;
  vatNumber: string | null;
  /** The first Riyadh day VAT may be charged (`YYYY-MM-DD`); null when not registered. */
  vatEffectiveFrom: string | null;
  address: NationalAddress | null;
};

export const SELLER: Seller = {
  nameEn: 'SRO Company',
  nameAr: 'شركة إس أر أو',
  crNumber: '7033242079',
  vatNumber: '314550511700003',
  vatEffectiveFrom: '2026-02-01',
  address: {
    buildingNumber: '7169',
    street: { ar: 'طريق الأمير محمد بن سعد بن عبدالعزيز', en: 'Prince Muhammad Ibn Saad Ibn Abdulaziz Rd' },
    district: { ar: 'حي الملقا', en: 'Al Malqa Dist.' },
    city: { ar: 'الرياض', en: 'Riyadh' },
    postalCode: '13524',
    secondaryNumber: '2369',
    shortAddress: 'RRMA7169',
  },
};

/**
 * The address as one line (digits stay ASCII in Arabic). The Arabic names each number rather than
 * writing `13524-2369`: a hyphenated pair of numbers can be reordered by right-to-left layout.
 */
export function addressLine(a: NationalAddress | null, lang: 'ar' | 'en'): string | null {
  if (!a) return null;
  return lang === 'ar'
    ? `${a.buildingNumber} ${a.street.ar}، ${a.district.ar}، ${a.city.ar}، الرمز البريدي ${a.postalCode}، الرقم الفرعي ${a.secondaryNumber}، المملكة العربية السعودية، العنوان المختصر ${a.shortAddress}`
    : `${a.buildingNumber} ${a.street.en}, ${a.district.en}, ${a.city.en} ${a.postalCode}-${a.secondaryNumber}, Saudi Arabia (${a.shortAddress})`;
}

/** The first instant VAT may be charged: midnight in Riyadh (UTC+3) on the effective day. */
export function vatEffectiveInstant(seller: Seller): Date | null {
  return seller.vatEffectiveFrom ? new Date(`${seller.vatEffectiveFrom}T00:00:00+03:00`) : null;
}
