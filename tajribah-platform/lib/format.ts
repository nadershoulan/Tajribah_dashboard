/**
 * Formatters for the Saudi context (§11).
 *
 * Timezone is Asia/Riyadh everywhere, the weekend is Friday–Saturday, dates are Gregorian
 * with Hijri available alongside, and numbers stay in ASCII digits — Arabic-Indic digits
 * are folded on *input* (see `foldDigits`), and a dashboard full of ٠١٢ is harder to scan
 * against invoices and provider dashboards that all use ASCII.
 */
import type { Lang } from './lang';

export const RIYADH = 'Asia/Riyadh';

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options);
  let existing = dateFormatters.get(key);
  if (!existing) {
    existing = new Intl.DateTimeFormat(locale, { timeZone: RIYADH, ...options });
    dateFormatters.set(key, existing);
  }
  return existing;
}

const localeOf = (lang: Lang) => (lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB');

/** `22 سبتمبر 2026` / `22 Sep 2026`. */
export function formatDate(value: Date | number | string, lang: Lang = 'ar'): string {
  return formatter(localeOf(lang), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

/** With the time, for audit logs and job history. */
export function formatDateTime(value: Date | number | string, lang: Lang = 'ar'): string {
  return formatter(localeOf(lang), {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

/** `12 رجب 1447` — shown beside the Gregorian date, never instead of it. */
export function formatHijri(value: Date | number | string, lang: Lang = 'ar'): string {
  return new Intl.DateTimeFormat(
    lang === 'ar' ? 'ar-SA-u-nu-latn-ca-islamic-umalqura' : 'en-GB-u-ca-islamic-umalqura',
    { timeZone: RIYADH, day: 'numeric', month: 'long', year: 'numeric' },
  ).format(new Date(value));
}

/** `منذ ٣ أيام` / `3 days ago`, to the nearest sensible unit. */
export function formatRelative(value: Date | number | string, lang: Lang = 'ar', now = Date.now()): string {
  const diff = new Date(value).getTime() - now;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 3600_000], ['month', 30 * 24 * 3600_000], ['day', 24 * 3600_000],
    ['hour', 3600_000], ['minute', 60_000], ['second', 1000],
  ];
  const rtf = new Intl.RelativeTimeFormat(lang === 'ar' ? 'ar' : 'en', { numeric: 'auto' });
  for (const [unit, ms] of units) {
    if (Math.abs(diff) >= ms || unit === 'second') return rtf.format(Math.round(diff / ms), unit);
  }
  return '';
}

export function formatNumber(value: number, lang: Lang = 'ar', options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', options).format(value);
}

/** `12.4%` — one decimal, and never a fabricated precision beyond it. */
export function formatPercent(fraction: number, lang: Lang = 'ar'): string {
  // Intl's Arabic locales use the Arabic percent sign (U+066A); the product writes `%`
  // everywhere, like its digits (decision 2026-09-23: ASCII in Arabic text too).
  return formatNumber(fraction, lang, { style: 'percent', maximumFractionDigits: 1 }).replace(/\u066A/g, '%');
}

/** `1.4 GB`, `820 KB`. Model files are judged by this number, so it is always visible. */
/**
 * `digits` for the places where rounding would contradict a verdict beside it — 2.04 MB shown
 * as "2 MB" next to "over 2 MB" (the model size report, P1.14).
 */
export function formatBytes(bytes: number, lang: Lang = 'ar', digits?: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  const fraction = digits ?? (size < 10 && unit > 0 ? 1 : 0);
  return `${formatNumber(size, lang, { maximumFractionDigits: unit > 0 ? fraction : 0 })} ${units[unit]}`;
}

/** `+966 51 234 5678`, grouped the way it is read aloud. */
export function formatPhone(phone: string): string {
  const match = /^\+966(\d)(\d{4})(\d{4})$/.exec(phone);
  return match ? `+966 ${match[1]}${match[2].slice(0, 1)} ${match[2].slice(1)} ${match[3]}` : phone;
}

/** Friday and Saturday (§11) — used by scheduling and "next business day" copy. */
export function isWeekend(value: Date | number | string): boolean {
  // The day in Riyadh (UTC+3, no DST), not in UTC: Friday 00:00–03:00 is Thursday in UTC.
  const day = new Date(new Date(value).getTime() + 3 * 3600_000).getUTCDay();
  return day === 5 || day === 6;
}

/** `YYYY-MM-DD` in Riyadh — the key used by every rollup table. */
export function riyadhDay(value: Date | number | string = new Date()): string {
  const date = new Date(value);
  const riyadh = new Date(date.getTime() + 3 * 3600_000);
  return riyadh.toISOString().slice(0, 10);
}
