/**
 * P2.6 — the invoice contract, shared by the API (which issues and stores invoices) and the
 * invoice screen (which shows them). Money is integer halalas (T5).
 *
 * VAT is computed **per line**, rounded half-up to the halala, and the invoice's VAT is the sum
 * of its lines — so every figure printed on the invoice adds up exactly, which is what a reader
 * (and ZATCA's validation) checks.
 */
import { vatOf } from '../money';

/** 15 %, in basis points (§11). */
export const VAT_RATE_BP = 1500;

export type InvoiceLineInput = {
  description: string;
  descriptionAr: string | null;
  quantity: number;
  unitPriceMinor: number;
};

export type PricedLine = InvoiceLineInput & { amountMinor: number; taxMinor: number };

export type PricedInvoice = {
  lines: PricedLine[];
  subtotalMinor: number;
  vatRateBp: number;
  vatMinor: number;
  totalMinor: number;
};

/** Price the lines. Refuses what cannot be on an invoice: no lines, a zero or fractional quantity, a negative price. */
export function priceInvoiceLines(lines: InvoiceLineInput[], rateBp = VAT_RATE_BP): PricedInvoice {
  if (lines.length === 0) throw new Error('an invoice needs at least one line');
  const priced = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new Error(`quantity must be a whole number ≥ 1: ${line.quantity}`);
    if (!Number.isInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) throw new Error(`price must be whole halalas ≥ 0: ${line.unitPriceMinor}`);
    if (!line.description.trim()) throw new Error('every line needs a description');
    const amountMinor = line.quantity * line.unitPriceMinor;
    return { ...line, amountMinor, taxMinor: vatOf(amountMinor, rateBp / 10_000) };
  });
  const subtotalMinor = priced.reduce((sum, l) => sum + l.amountMinor, 0);
  const vatMinor = priced.reduce((sum, l) => sum + l.taxMinor, 0);
  return { lines: priced, subtotalMinor, vatRateBp: rateBp, vatMinor, totalMinor: subtotalMinor + vatMinor };
}

export type InvoiceParty = {
  name: string;
  nameAr: string | null;
  crNumber: string | null;
  vatNumber: string | null;
  address: string | null;
  /** The address in Arabic, when it was recorded in both languages (the seller's is). */
  addressAr?: string | null;
};

/** What the invoice screen shows: everything as it was when the invoice was issued. */
export type InvoiceDocument = PricedInvoice & {
  id: string;
  number: string;
  status: 'draft' | 'issued' | 'paid' | 'void' | 'refunded';
  /** A buyer with a VAT number gets a (standard) tax invoice; without one, a simplified tax invoice. */
  kind: 'standard' | 'simplified';
  currency: string;
  issuedAt: string;
  dueAt: string | null;
  paidAt: string | null;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  /** Filled by the ZATCA provider (P2.7) — never computed here. */
  zatca: { status: 'pending' | 'reported' | 'cleared' | 'failed' | null; qr: string | null };
};
