import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldDigits, formatMoney, fromGross, toMajor, toMinor, vatOf } from '@/lib/money';
import { formatDate, formatHijri, formatNumber, formatPercent, formatPhone, isWeekend, riyadhDay } from '@/lib/format';
import { FEATURE_LABELS, LIMIT_LABELS, PLANS } from '@/lib/plans';
import * as nav from '@/lib/nav';
import { normalisePhone } from '@/server/modules/auth/service';

const ARABIC_INDIC = /[٠-٩۰-۹]/;

test('Arabic-Indic and Extended Arabic-Indic digits fold to ASCII', () => {
  assert.equal(foldDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(foldDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(foldDigits('رمز ١٢٣ و 456'), 'رمز 123 و 456');
});

test('every Saudi way of writing a mobile number normalises to E.164', () => {
  for (const input of [
    '0501234567', '٠٥٠١٢٣٤٥٦٧', '+966 50 123 4567', '966501234567', '00966501234567',
    '٠٠٩٦٦٥٠١٢٣٤٥٦٧', '501234567', '(050) 123-4567',
  ]) {
    assert.equal(normalisePhone(input), '+966501234567', input);
  }
  assert.equal(formatPhone('+966512345678'), '+966 51 234 5678');
});

test('money parses exactly, including Arabic digits and separators, with no float drift', () => {
  assert.equal(toMinor('299.00'), 29900);
  assert.equal(toMinor('٢٩٩٫٥'), 29950, 'Arabic decimal separator');
  assert.equal(toMinor('1,299.99'), 129999);
  assert.equal(toMinor('1.234', 'KWD'), 1234);
  assert.throws(() => toMinor('12abc'), RangeError);
  // Every amount from 0.00 to 2,000.00 round-trips exactly.
  for (let minor = 0; minor <= 200_000; minor++) {
    const text = toMajor(minor);
    assert.equal(toMinor(text), minor, text);
  }
  assert.equal(toMajor(-150), '-1.50');
});

test('VAT is 15%, and net + VAT always equals gross', () => {
  assert.equal(vatOf(10_000), 1_500);
  assert.deepEqual(fromGross(11_500), { netMinor: 10_000, vatMinor: 1_500 });
  for (let gross = 0; gross <= 50_000; gross++) {
    const { netMinor, vatMinor } = fromGross(gross);
    assert.equal(netMinor + vatMinor, gross);
  }
  assert.equal(formatMoney(29900, 'SAR', 'ar'), '299.00 ر.س');
  assert.equal(formatMoney(29900, 'SAR', 'en'), 'SAR 299.00');
  assert.equal(formatMoney(29900, 'SAR', 'ar', { compact: true }), '299 ر.س');
});

test('the weekend is Friday–Saturday in Riyadh, not in UTC', () => {
  // 2026-09-25 is a Friday. 00:30 Friday in Riyadh is still Thursday 21:30 in UTC.
  assert.equal(isWeekend('2026-09-24T21:30:00Z'), true, 'Friday 00:30 Riyadh');
  assert.equal(isWeekend('2026-09-24T20:30:00Z'), false, 'Thursday 23:30 Riyadh');
  assert.equal(isWeekend('2026-09-26T20:59:00Z'), true, 'Saturday 23:59 Riyadh');
  assert.equal(isWeekend('2026-09-26T21:00:00Z'), false, 'Sunday 00:00 Riyadh');
  assert.equal(riyadhDay('2026-09-24T21:30:00Z'), '2026-09-25');
});

test('dates render in ASCII digits in both languages, with Hijri available', () => {
  for (const lang of ['ar', 'en'] as const) {
    const g = formatDate('2026-09-25T09:00:00Z', lang);
    const h = formatHijri('2026-09-25T09:00:00Z', lang);
    assert.match(g, /25/);
    assert.match(g, /2026/);
    assert.match(h, /1448/, 'September 2026 is in 1448 AH');
    assert.doesNotMatch(g + h, ARABIC_INDIC, `${lang}: digits must stay ASCII`);
  }
});

test('Arabic copy uses ASCII digits and %, like the data beside it (decision 2026-09-23)', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  // money.ts and format.ts *accept* Arabic-Indic digits on input; that is their job.
  const allowed = /(lib[\\/](money|format)\.ts$|__tests__)/;
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry) || allowed.test(full)) continue;
      readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        if (/[٠-٩۰-۹٪-٬]/.test(line)) offenders.push(`${relative(process.cwd(), full)}:${i + 1}`);
      });
    }
  };
  for (const dir of ['components', 'lib', 'app', 'server', 'content']) {
    try { walk(join(process.cwd(), dir)); } catch { /* folder absent */ }
  }
  assert.deepEqual(offenders, [], 'Write 30, 15% and 1.5 in Arabic strings too');
  assert.equal(formatPercent(0.069, 'ar').includes('%'), true);
  assert.doesNotMatch(formatPercent(0.069, 'ar') + formatNumber(1234567.5, 'ar'), ARABIC_INDIC);
});

/** Every `{ ar, en }` pair reachable from `value`. */
function bilingualPairs(value: unknown, path: string, out: [string, { ar: unknown; en: unknown }][] = []) {
  if (!value || typeof value !== 'object') return out;
  const keys = Object.keys(value);
  if (keys.includes('ar') && keys.includes('en')) out.push([path, value as { ar: unknown; en: unknown }]);
  for (const [key, child] of Object.entries(value)) bilingualPairs(child, `${path}.${key}`, out);
  return out;
}

test('every bilingual string in the data files has both languages, and the Arabic is Arabic', () => {
  const pairs = bilingualPairs({ PLANS, FEATURE_LABELS, LIMIT_LABELS, nav }, 'lib');
  assert.ok(pairs.length > 30, `found only ${pairs.length} pairs — the walk is broken`);
  for (const [path, pair] of pairs) {
    assert.ok(typeof pair.ar === 'string' && pair.ar.trim(), `${path}: missing Arabic`);
    assert.ok(typeof pair.en === 'string' && pair.en.trim(), `${path}: missing English`);
    assert.match(pair.ar as string, /[؀-ۿ]/, `${path}: the Arabic side has no Arabic in it`);
    assert.notEqual(pair.ar, pair.en, `${path}: not translated`);
  }
});

test('formatBytes: extra digits where rounding would contradict an over/under verdict', async () => {
  const { formatBytes } = await import('@/lib/format');
  const justOver = 2 * 1024 * 1024 + 50_000;
  assert.equal(formatBytes(justOver, 'en'), '2 MB', 'the default rounding hides it…');
  assert.equal(formatBytes(justOver, 'en', 2), '2.05 MB', '…two digits show it');
  assert.equal(formatBytes(512, 'en', 2), '512 B', 'bytes never get decimals');
});
