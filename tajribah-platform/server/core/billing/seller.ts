/**
 * P2.6 — the legal seller on every Tajribah invoice.
 *
 * Supplied by Nader on 2026-09-26: SRO Company operates Tajribah. From the Ministry of
 * Commerce certificate (issued 2023-03-20, active, one-person LLC) — the unified national
 * number is the CR number. The Arabic name is as the bank writes it.
 *
 * `vatNumber` is **SRO Company's own** ZATCA TRN and has not been supplied. The IBAN letter
 * that came with the certificate shows 300002471110003 — that is Saudi National Bank's VAT
 * number, not SRO's, and must never appear here. Until the real one is set, `issueInvoice`
 * refuses: a tax invoice without the seller's VAT number is not a tax invoice.
 *
 * In code rather than the environment: these are legal facts that change rarely and should
 * change through review, and every invoice snapshots them at issue, so a later change never
 * rewrites an invoice already sent.
 */
export type Seller = {
  nameEn: string;
  nameAr: string;
  crNumber: string;
  vatNumber: string | null;
  nationalAddress: string | null;
};

export const SELLER: Seller = {
  nameEn: 'SRO Company',
  nameAr: 'شركة إس أر أو',
  crNumber: '7033242079',
  vatNumber: null,
  nationalAddress: null,
};
