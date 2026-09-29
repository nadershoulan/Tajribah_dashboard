/**
 * P6 — WooCommerce prices are decimal strings in the store's currency ("1250.50", "0", ""). Our
 * money is whole minor units (T5). The conversion is exact string arithmetic — never a float — and
 * uses the currency's own minor unit (ISO 4217): halalas for SAR, but fils for KWD, BHD and OMR
 * are thousandths. A price with more decimals than its currency has is refused, not rounded.
 */
const MINOR_DIGITS: Record<string, number> = {
  SAR: 2, AED: 2, QAR: 2, EGP: 2, USD: 2, EUR: 2, GBP: 2,
  KWD: 3, BHD: 3, OMR: 3, JOD: 3,
  JPY: 0, KRW: 0,
};

/** Decimal places of `currency`'s minor unit (2 when the table does not name it). */
export const minorDigits = (currency: string): number => MINOR_DIGITS[currency.toUpperCase()] ?? 2;

/** "1250.50" in SAR → 125050. Empty → null. Anything else malformed → null (no price shown, not a wrong one). */
export function toMinor(price: string | number | null | undefined, currency: string): number | null {
  if (price === null || price === undefined) return null;
  const text = String(price).trim();
  if (text === '') return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const digits = minorDigits(currency);
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (fraction.length > digits) return null;
  const minor = Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 125050 in SAR → "1250.50" (how the store double writes a price). */
export function fromMinor(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const text = String(minor).padStart(digits + 1, '0');
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}
