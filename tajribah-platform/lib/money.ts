/**
 * Money is an integer count of minor units plus a currency code (T5). Never a float:
 * 0.1 + 0.2 is not 0.3, and an invoice that disagrees with itself by a halala is a
 * ZATCA problem, not a rounding curiosity.
 *
 * SAR has 2 minor digits, so 299.00 SAR is 29900.
 */

export const SAR = 'SAR';
export const VAT_RATE = 0.15; // KSA standard rate (§11)

const MINOR_DIGITS: Record<string, number> = { SAR: 2, USD: 2, AED: 2, KWD: 3, BHD: 3, OMR: 3 };

export type Money = { amountMinor: number; currency: string };

export const money = (amountMinor: number, currency = SAR): Money => ({ amountMinor, currency });

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

/** `299.00` → `29900`. Accepts Arabic-Indic digits; throws on anything else. */
export function toMinor(major: string | number, currency = SAR): number {
  const text = foldDigits(String(major)).replace(/\u066B/g, '.').replace(/[\s,\u066C]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new RangeError(`not a number: ${major}`);
  const factor = 10 ** minorDigits(currency);
  return Math.round(Number(text) * factor);
}

/** `29900` → `299.00`, plain ASCII digits, no currency symbol. */
export function toMajor(amountMinor: number, currency = SAR): string {
  const digits = minorDigits(currency);
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor).toString().padStart(digits + 1, '0');
  return digits === 0 ? sign + abs : `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
}

const SYMBOL: Record<string, { ar: string; en: string }> = {
  SAR: { ar: 'ر.س', en: 'SAR' },
  USD: { ar: '$', en: '$' },
};

/**
 * `29900` → `299.00 ر.س` in Arabic, `SAR 299.00` in English.
 * `compact` drops the minor part, which is how prices read on marketing pages (§11).
 */
export function formatMoney(
  amountMinor: number,
  currency = SAR,
  lang: 'ar' | 'en' = 'ar',
  opts: { compact?: boolean } = {},
): string {
  const digits = opts.compact ? 0 : minorDigits(currency);
  const value = amountMinor / 10 ** minorDigits(currency);
  const number = value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const symbol = SYMBOL[currency.toUpperCase()]?.[lang] ?? currency.toUpperCase();
  return lang === 'ar' ? `${number} ${symbol}` : `${symbol} ${number}`;
}

/** VAT on a net amount, rounded half-up to the minor unit. */
export function vatOf(netMinor: number, rate = VAT_RATE): number {
  return Math.round(netMinor * rate);
}

/** Split a gross amount that already includes VAT back into net + tax. */
export function fromGross(grossMinor: number, rate = VAT_RATE): { netMinor: number; vatMinor: number } {
  const netMinor = Math.round(grossMinor / (1 + rate));
  return { netMinor, vatMinor: grossMinor - netMinor };
}

/**
 * Arabic-Indic (٠١٢…) and Extended Arabic-Indic (۰۱۲…) digits folded to ASCII.
 * §13.6: every phone, OTP and numeric input must do this — a Saudi keyboard produces
 * U+0660 digits and `parseInt` returns NaN for them.
 */
export function foldDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}
